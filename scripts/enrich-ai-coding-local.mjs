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

// Ensure patch directory exists
if (!fs.existsSync(PATCH_DIR)) {
  fs.mkdirSync(PATCH_DIR, { recursive: true });
}

// Helper functions for generating explanations
function generateChineseExplanation(option, optionIndex, allOptions, correctIndices, why, scenario) {
  const isCorrect = correctIndices.includes(optionIndex);

  if (isCorrect) {
    // For correct options, affirm why it's right
    return `这是正确的选项，因为${why.substring(0, 30)}...`;
  } else {
    // For wrong options, explain why it's wrong
    const contrast = allOptions.length > optionIndex + 1
      ? `不同于选项 ${correctIndices[0] + 1}`
      : '这个说法不准确或过于片面';
    return `这个选项在这里不对，${contrast}。`;
  }
}

function generateEnglishExplanation(option, optionIndex, allOptions, correctIndices, why_en, scenario) {
  const isCorrect = correctIndices.includes(optionIndex);

  if (isCorrect) {
    // For correct options, affirm why it's right
    const prefix = correctIndices.length > 1 ? 'This is one of the correct options' : 'This is correct';
    return `${prefix} because ${why_en.toLowerCase()}.`;
  } else {
    // For wrong options, explain why it's wrong
    return `This option is not correct in this context; ${option.toLowerCase()} doesn't align with the key principle.`;
  }
}

function processCard(card) {
  const { id, q, options, answer, why, why_en, scenario, format } = card;

  // Skip cards that already have explanations
  if (card.optionExplanations) {
    return null;
  }

  const optionExplanations = options.map((option, idx) =>
    generateChineseExplanation(option, idx, options, answer, why, scenario)
  );

  const optionExplanations_en = options.map((option, idx) =>
    generateEnglishExplanation(option, idx, options, answer, why_en, scenario)
  );

  return {
    optionExplanations,
    optionExplanations_en
  };
}

function processDeck(deckFile) {
  const deckPath = path.join(CONTENT_DIR, deckFile);
  console.log(`\nProcessing ${deckFile}...`);

  const cards = JSON.parse(fs.readFileSync(deckPath, 'utf-8'));

  // Filter to choice cards
  const choiceCards = cards.filter(card =>
    (card.format === 'mcq' || card.format === 'multi' || card.format === 'code') &&
    !card.optionExplanations
  );

  console.log(`  Found ${choiceCards.length} choice cards to enrich`);

  const patches = {};
  let successCount = 0;

  for (const card of choiceCards) {
    try {
      const explanations = processCard(card);
      if (explanations) {
        patches[card.id] = explanations;
        successCount++;
      }
    } catch (error) {
      console.error(`  ✗ ${card.id}: ${error.message}`);
    }
  }

  // Write patch file
  const patchFileName = `ai-coding__${deckFile}`;
  const patchPath = path.join(PATCH_DIR, patchFileName);

  fs.writeFileSync(patchPath, JSON.stringify(patches, null, 2) + '\n');

  console.log(`  ✓ Wrote patch: ${patchFileName} (${successCount}/${choiceCards.length} cards)`);

  return { deckFile, successCount, totalCards: choiceCards.length };
}

function main() {
  console.log('Starting AI Coding enrichment (local generation)...');
  const results = [];

  for (const deck of DECKS) {
    try {
      const result = processDeck(deck);
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
  console.log('\nNOTE: These are template enrichments. For production, use the API-based script with proper explanations.');
}

main();
