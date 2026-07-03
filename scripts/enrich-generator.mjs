#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

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

if (!fs.existsSync(PATCH_DIR)) {
  fs.mkdirSync(PATCH_DIR, { recursive: true });
}

/**
 * Extract meaningful phrase from why text
 */
function extractPhrase(text, maxLen = 60) {
  // Remove punctuation and get first meaningful chunk
  return text
    .split(/[，。；：、]/)[0]
    .trim()
    .substring(0, maxLen);
}

/**
 * Generate Chinese explanation for an option
 */
function generateChineseExplanation(option, optionIndex, allOptions, correctIndices, card) {
  const { why, format } = card;
  const isCorrect = correctIndices.includes(optionIndex);

  if (isCorrect) {
    const phrase = extractPhrase(why);
    return `是的，${phrase}是关键`;
  } else {
    // For wrong options, explain why
    if (option.includes('不') || option.includes('没有')) {
      return `不对，说法过于绝对；实际上需要${extractPhrase(why)}`;
    }
    if (option.includes('只') || option.includes('完全')) {
      return `过于片面，${option.substring(0, 15)}忽视了${extractPhrase(why)}`;
    }
    if (option.includes('不需要') || option.includes('无需')) {
      return `错误，${option.substring(0, 15)}；实际上${extractPhrase(why)}`;
    }
    return `这不是主要问题，关键是${extractPhrase(why)}`;
  }
}

/**
 * Generate English explanation for an option
 */
function generateEnglishExplanation(option, optionIndex, allOptions, correctIndices, card) {
  const { why_en, format } = card;
  const isCorrect = correctIndices.includes(optionIndex);

  const phrase = extractPhrase(why_en, 80);

  if (isCorrect) {
    return `Yes, this is right: ${phrase}.`;
  } else {
    // For wrong options, explain why
    if (option.toLowerCase().includes('no') || option.toLowerCase().includes('never')) {
      return `Not quite; while that sounds absolute, the real signal is ${phrase}.`;
    }
    if (option.toLowerCase().includes('only') || option.toLowerCase().includes('just')) {
      return `Too narrow; it matters but it's not the main signal—${phrase}.`;
    }
    if (option.toLowerCase().includes("don't") || option.toLowerCase().includes("dont")) {
      return `Actually no, that's wrong; you need to ${phrase}.`;
    }
    return `This isn't the key issue; what matters is ${phrase}.`;
  }
}

/**
 * Process a single card and generate enrichment
 */
function generateEnrichment(card) {
  const { id, format, options, answer, why, why_en, scenario } = card;

  // Validate we have what we need
  if (!options || !answer || !why || !why_en) {
    return null;
  }

  const optionExplanations = options.map((option, idx) =>
    generateChineseExplanation(option, idx, options, answer, card)
  );

  const optionExplanations_en = options.map((option, idx) =>
    generateEnglishExplanation(option, idx, options, answer, card)
  );

  return {
    optionExplanations,
    optionExplanations_en
  };
}

/**
 * Process a single deck file
 */
function processDeck(deckFile) {
  const deckPath = path.join(CONTENT_DIR, deckFile);
  console.log(`\nProcessing ${deckFile}...`);

  const cards = JSON.parse(fs.readFileSync(deckPath, 'utf-8'));

  // Filter to choice cards that don't already have explanations
  const choiceCards = cards.filter(card =>
    (card.format === 'mcq' || card.format === 'multi' || card.format === 'code') &&
    !card.optionExplanations
  );

  console.log(`  Found ${choiceCards.length} choice cards to enrich`);

  const patches = {};
  let successCount = 0;
  let failCount = 0;

  for (const card of choiceCards) {
    try {
      const enrichment = generateEnrichment(card);
      if (enrichment) {
        patches[card.id] = enrichment;
        successCount++;
      } else {
        failCount++;
      }
    } catch (error) {
      console.error(`  ✗ ${card.id}: ${error.message}`);
      failCount++;
    }
  }

  // Write patch file
  const patchFileName = `ai-coding__${deckFile}`;
  const patchPath = path.join(PATCH_DIR, patchFileName);

  fs.writeFileSync(patchPath, JSON.stringify(patches, null, 2) + '\n');

  console.log(`  ✓ Wrote patch: ${patchFileName} (${successCount}/${choiceCards.length} cards)`);

  return { deckFile, successCount, totalCards: choiceCards.length };
}

/**
 * Main execution
 */
function main() {
  console.log('Starting AI Coding enrichment generation...\n');
  const results = [];

  for (const deck of DECKS) {
    try {
      const result = processDeck(deck);
      results.push(result);
    } catch (error) {
      console.error(`✗ Failed to process ${deck}: ${error.message}`);
    }
  }

  console.log('\n========== Summary ==========');
  let totalPatched = 0;
  for (const result of results) {
    console.log(`${result.deckFile}: ${result.successCount}/${result.totalCards} cards patched`);
    totalPatched += result.successCount;
  }
  console.log(`\nTotal: ${totalPatched} cards enriched across ${DECKS.length} decks`);
  console.log('\n✓ Patch files created in scripts/enrich-patches/');
}

main();
