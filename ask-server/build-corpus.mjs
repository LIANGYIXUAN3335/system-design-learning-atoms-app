import { readFileSync, writeFileSync } from 'node:fs';

const deck = JSON.parse(readFileSync(new URL('../src/content/deck.bundle.json', import.meta.url), 'utf8'));
const records = deck.map((card) => ({
  id: card.id,
  kind: 'card',
  title: card.sub,
  section: card.topic,
  corpus: 'atoms',
  cite: `Atoms card ${card.id}`,
  text: [card.q_en || card.q, card.why_en || card.why].filter(Boolean).join('\n'),
}));
writeFileSync(new URL('./data/corpus.jsonl', import.meta.url), records.map((item) => JSON.stringify(item)).join('\n') + '\n');
