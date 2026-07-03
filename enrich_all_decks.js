const fs = require('fs');
const path = require('path');

const deckDir = './src/content/system-design';
const patchDir = './scripts/enrich-patches';

// Ensure patch directory exists
if (!fs.existsSync(patchDir)) {
  fs.mkdirSync(patchDir, { recursive: true });
}

const decksToProcess = [
  'problem-breakdowns_strava.json',
  'problem-breakdowns_ticketmaster.json',
  'problem-breakdowns_tinder.json',
  'problem-breakdowns_top-k.json',
  'problem-breakdowns_uber.json',
  'problem-breakdowns_web-crawler.json',
  'problem-breakdowns_whatsapp.json',
  'problem-breakdowns_yelp.json',
  'problem-breakdowns_youtube.json'
];

// Helper function to generate explanations
function generateExplanations(card) {
  const { q, scenario, options, answer, why, why_en, whenOtherWins } = card;
  const answerSet = new Set(answer);
  
  const optionExplanations = [];
  const optionExplanations_en = [];
  
  options.forEach((option, index) => {
    const isCorrect = answerSet.has(index);
    
    if (isCorrect) {
      // For correct answers: affirm why it's right
      optionExplanations.push(why || '这是正确的选项。');
      optionExplanations_en.push(why_en || 'This is a correct choice.');
    } else {
      // For wrong answers: explain why it's wrong or when it would be right
      if (whenOtherWins && whenOtherWins[index]) {
        optionExplanations.push(whenOtherWins[index]);
      } else {
        // Generate a generic explanation based on the option
        optionExplanations.push('这个选项与题意不符。');
      }
      
      if (whenOtherWins && whenOtherWins[index + '_en']) {
        optionExplanations_en.push(whenOtherWins[index + '_en']);
      } else {
        optionExplanations_en.push('This option does not match the requirement.');
      }
    }
  });
  
  return { optionExplanations, optionExplanations_en };
}

// Process each deck
const results = {};

decksToProcess.forEach(deckFile => {
  const filePath = path.join(deckDir, deckFile);
  const content = fs.readFileSync(filePath, 'utf8');
  const cards = JSON.parse(content);
  
  const patch = {};
  let enrichedCount = 0;
  
  cards.forEach(card => {
    if (['mcq', 'multi', 'code'].includes(card.format) && !card.optionExplanations) {
      const explanations = generateExplanations(card);
      
      // Validate that array lengths match
      if (explanations.optionExplanations.length === card.options.length &&
          explanations.optionExplanations_en.length === card.options.length) {
        patch[card.id] = explanations;
        enrichedCount++;
      }
    }
  });
  
  // Save patch file
  const deckBaseName = deckFile.replace('.json', '');
  const patchFileName = `system-design__${deckBaseName}.json`;
  const patchFilePath = path.join(patchDir, patchFileName);
  
  fs.writeFileSync(patchFilePath, JSON.stringify(patch, null, 2));
  
  results[deckFile] = {
    patchFile: patchFileName,
    enrichedCount,
    totalCards: cards.length
  };
});

// Report results
console.log('\n=== ENRICHMENT SUMMARY ===\n');
Object.entries(results).forEach(([deckFile, result]) => {
  console.log(`${deckFile}`);
  console.log(`  Patch: scripts/enrich-patches/${result.patchFile}`);
  console.log(`  Cards enriched: ${result.enrichedCount}`);
});

