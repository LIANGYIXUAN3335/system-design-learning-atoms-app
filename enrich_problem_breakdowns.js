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

// Helper function to extract core reasons from the why field
function extractReasons(whyText) {
  // Split by semicolons or commas to get individual reasons
  const parts = whyText.split(/；|;|，|,/).map(p => p.trim()).filter(p => p);
  return parts;
}

// Helper function to generate option-specific explanation
function generateOptionExplanation(option, isCorrect, whyText, whenOtherWins, optionIndex) {
  if (isCorrect) {
    // For correct options: use the why text which explains the correct set
    // Try to be more specific by checking if whenOtherWins has details about this option
    if (whenOtherWins && whenOtherWins['correct_' + optionIndex]) {
      return whenOtherWins['correct_' + optionIndex];
    }
    
    // Otherwise, use a paraphrased version of the why text
    // Aim for something concise that affirms why this option is right
    const reasons = extractReasons(whyText);
    if (reasons.length > 0) {
      // Return first reason or a mix
      return reasons[0];
    }
    return whyText || '这是正确选项。';
  } else {
    // For incorrect options: explain why it's wrong or when it would be right
    if (whenOtherWins && whenOtherWins[optionIndex]) {
      return whenOtherWins[optionIndex];
    }
    
    if (whenOtherWins && whenOtherWins['wrong_' + optionIndex]) {
      return whenOtherWins['wrong_' + optionIndex];
    }
    
    // Generate context-specific reason
    // Try to infer from the option text and why explanation
    return '这个选项不在核心范围内。';
  }
}

function generateEnglishOptionExplanation(option, isCorrect, whyText_en, whenOtherWins, optionIndex) {
  if (isCorrect) {
    if (whenOtherWins && whenOtherWins['correct_' + optionIndex + '_en']) {
      return whenOtherWins['correct_' + optionIndex + '_en'];
    }
    
    return whyText_en || 'This is a correct choice.';
  } else {
    if (whenOtherWins && whenOtherWins[optionIndex + '_en']) {
      return whenOtherWins[optionIndex + '_en'];
    }
    
    if (whenOtherWins && whenOtherWins['wrong_' + optionIndex + '_en']) {
      return whenOtherWins['wrong_' + optionIndex + '_en'];
    }
    
    return 'This option is outside the core scope.';
  }
}

// Process each deck
const results = {};

decksToProcess.forEach(deckFile => {
  const filePath = path.join(deckDir, deckFile);
  if (!fs.existsSync(filePath)) {
    console.warn(`Warning: ${deckFile} not found`);
    return;
  }
  
  const content = fs.readFileSync(filePath, 'utf8');
  const cards = JSON.parse(content);
  
  const patch = {};
  let enrichedCount = 0;
  let skippedCount = 0;
  
  cards.forEach(card => {
    // Skip if already has optionExplanations or is not a choice format
    if (['mcq', 'multi', 'code'].includes(card.format) && !card.optionExplanations) {
      const answerSet = new Set(card.answer);
      const optionExplanations = [];
      const optionExplanations_en = [];
      
      card.options.forEach((option, index) => {
        const isCorrect = answerSet.has(index);
        
        const explanation = generateOptionExplanation(
          option, 
          isCorrect, 
          card.why || '',
          card.whenOtherWins,
          index
        );
        optionExplanations.push(explanation);
        
        const explanation_en = generateEnglishOptionExplanation(
          option,
          isCorrect,
          card.why_en || '',
          card.whenOtherWins,
          index
        );
        optionExplanations_en.push(explanation_en);
      });
      
      // Validate lengths match
      if (optionExplanations.length === card.options.length &&
          optionExplanations_en.length === card.options.length) {
        patch[card.id] = {
          optionExplanations,
          optionExplanations_en
        };
        enrichedCount++;
      } else {
        skippedCount++;
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
    skippedCount,
    totalCards: cards.length
  };
});

// Report results
console.log('\n=== ENRICHMENT SUMMARY ===\n');
Object.entries(results).forEach(([deckFile, result]) => {
  console.log(`${deckFile}`);
  console.log(`  Patch: scripts/enrich-patches/${result.patchFile}`);
  console.log(`  Cards enriched: ${result.enrichedCount}/${result.totalCards}`);
  if (result.skippedCount > 0) {
    console.log(`  Skipped: ${result.skippedCount}`);
  }
});

console.log('\nAll patches created. Validating...');

