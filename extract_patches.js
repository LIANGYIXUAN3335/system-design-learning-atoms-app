const fs = require('fs');
const path = require('path');

const deckDir = './src/content/system-design';
const patchDir = './scripts/enrich-patches';

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

const results = {};

decksToProcess.forEach(deckFile => {
  const filePath = path.join(deckDir, deckFile);
  const content = fs.readFileSync(filePath, 'utf8');
  const cards = JSON.parse(content);
  
  const patch = {};
  let count = 0;
  
  cards.forEach(card => {
    if (card.optionExplanations && card.optionExplanations_en) {
      patch[card.id] = {
        optionExplanations: card.optionExplanations,
        optionExplanations_en: card.optionExplanations_en
      };
      count++;
    }
  });
  
  // Save patch file
  const deckBaseName = deckFile.replace('.json', '');
  const patchFileName = `system-design__${deckBaseName}.json`;
  const patchFilePath = path.join(patchDir, patchFileName);
  
  fs.writeFileSync(patchFilePath, JSON.stringify(patch, null, 2));
  
  results[deckFile] = {
    patchFile: patchFileName,
    count
  };
});

// Report results
console.log('\n=== PATCH EXTRACTION SUMMARY ===\n');
let totalCards = 0;
Object.entries(results).forEach(([deckFile, result]) => {
  console.log(`${deckFile}: ${result.count} cards`);
  totalCards += result.count;
});
console.log(`\nTotal cards enriched across all decks: ${totalCards}`);

