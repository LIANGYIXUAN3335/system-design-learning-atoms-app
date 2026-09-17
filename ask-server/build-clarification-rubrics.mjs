/**
 * Build the small, trusted rubric bundle for the public Copilot review endpoint.
 *
 * The browser sends only cardId, rubricVersion, answer, and requestId. Keeping
 * the prompt/rubric here means a client cannot replace the scoring line or send
 * a model its own invented "correct answer".
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const deckFile = join(HERE, '..', 'src', 'content', 'deck.bundle.json');
const outFile = join(HERE, 'data', 'clarification-rubrics.json');
const deck = JSON.parse(readFileSync(deckFile, 'utf8'));

const rubrics = deck
  .filter((card) => card?.clarificationReview)
  .map((card) => ({
    cardId: card.id,
    ...card.clarificationReview,
  }));

for (const item of rubrics) {
  if (!item.cardId || !item.version || !item.problem || !Array.isArray(item.rubric) || !Array.isArray(item.expectedAssumptions)) {
    throw new Error(`invalid clarification rubric for ${item.cardId || '(unknown)'}`);
  }
}

writeFileSync(outFile, `${JSON.stringify(rubrics, null, 2)}\n`);
console.log(`clarification rubrics: ${rubrics.length} → ${outFile}`);
