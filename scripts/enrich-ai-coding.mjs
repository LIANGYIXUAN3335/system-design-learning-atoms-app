#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY environment variable not set');
  process.exit(1);
}

const DECKS = [
  'fundamentals_codebase-orientation.json',
  'fundamentals_communication.json',
  'fundamentals_driving-the-ai.json',
  'fundamentals_planning-your-approach.json',
  'fundamentals_verification-and-testing.json',
  'overview_how-to-prepare.json',
  'overview_interview-formats.json',
  'overview_introduction.json',
  'overview_patterns.json',
];

const CONTENT_DIR = '/Users/yixuanliang/interview/Job_Search/system design learning/atoms-app/src/content/ai-coding';
const PATCH_DIR = '/Users/yixuanliang/interview/Job_Search/system design learning/atoms-app/scripts/enrich-patches';

// Ensure patch directory exists
if (!fs.existsSync(PATCH_DIR)) {
  fs.mkdirSync(PATCH_DIR, { recursive: true });
}

async function generateExplanations(card) {
  const { id, q, options, answer, why, why_en, scenario } = card;

  const prompt = `You are an expert at writing clear, concise explanations for multiple-choice/multi-select/code card options in an interview preparation system.

Card Details:
- Question (Chinese): ${q}
${scenario ? `- Scenario: ${scenario}` : ''}
- Options: ${JSON.stringify(options)}
- Correct answer(s): Option(s) ${answer.map(i => i).join(', ')} (0-indexed)
- Why correct: ${why}
- Why correct (English): ${why_en}

Your task: Write per-option explanations in BOTH Chinese and English.

Requirements:
1. For CORRECT options: Brief affirmation of why it's right
2. For WRONG options: Explain why it's wrong here, or when it might be right instead (be specific to this card's scenario)
3. Each explanation should be 1 concise sentence, natural and spoken-like in English
4. Return ONLY valid JSON in this exact format (no markdown, no code blocks):
{
  "optionExplanations": ["explanation for option 0 in Chinese", "explanation for option 1 in Chinese", ...],
  "optionExplanations_en": ["explanation for option 0 in English", "explanation for option 1 in English", ...]
}

Important: The arrays MUST have exactly ${options.length} elements, matching the number of options.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-1-20250805',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`API error: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const responseText = data.content[0].text;

    // Try to parse the response as JSON
    const parsed = JSON.parse(responseText);

    // Validate arrays have correct length
    if (parsed.optionExplanations.length !== options.length ||
        parsed.optionExplanations_en.length !== options.length) {
      console.error(`❌ ${id}: Array length mismatch (got ${parsed.optionExplanations.length}, expected ${options.length})`);
      return null;
    }

    return parsed;
  } catch (e) {
    console.error(`❌ ${id}: ${e.message}`);
    return null;
  }
}

async function processDeck(deckFile) {
  const deckPath = path.join(CONTENT_DIR, deckFile);
  console.log(`\nProcessing ${deckFile}...`);

  const cards = JSON.parse(fs.readFileSync(deckPath, 'utf-8'));

  // Filter to choice cards that don't already have optionExplanations
  const choiceCards = cards.filter(card =>
    (card.format === 'mcq' || card.format === 'multi' || card.format === 'code') &&
    !card.optionExplanations
  );

  console.log(`  Found ${choiceCards.length} choice cards to enrich`);

  const patches = {};
  let successCount = 0;

  // Process in batches to avoid rate limiting
  for (let i = 0; i < choiceCards.length; i++) {
    const card = choiceCards[i];

    try {
      const explanations = await generateExplanations(card);
      if (explanations) {
        patches[card.id] = explanations;
        successCount++;
        console.log(`  ✓ ${card.id}`);
      }
    } catch (error) {
      console.error(`  ✗ ${card.id}: ${error.message}`);
    }

    // Rate limiting: wait between batches
    if ((i + 1) % 5 === 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Write patch file
  const patchFileName = `ai-coding__${deckFile}`;
  const patchPath = path.join(PATCH_DIR, patchFileName);

  fs.writeFileSync(patchPath, JSON.stringify(patches, null, 2) + '\n');

  console.log(`  ✓ Wrote patch: ${patchFileName} (${successCount}/${choiceCards.length} cards)`);

  return { deckFile, successCount, totalCards: choiceCards.length };
}

async function main() {
  console.log('Starting AI Coding enrichment...');
  const results = [];

  for (const deck of DECKS) {
    try {
      const result = await processDeck(deck);
      results.push(result);
    } catch (error) {
      console.error(`Failed to process ${deck}: ${error.message}`);
    }
  }

  console.log('\n========== Summary ==========');
  let totalPatched = 0;
  for (const result of results) {
    console.log(`${result.deckFile}: ${result.successCount}/${result.totalCards} cards patched`);
    totalPatched += result.successCount;
  }
  console.log(`\nTotal: ${totalPatched} cards enriched across ${DECKS.length} decks`);
}

main().catch(console.error);
