#!/usr/bin/env node
/**
 * Source-coverage gate.
 *
 * Card generation used to stop at a quota, not when the article was exhausted — 7 low-level-design
 * decks landed on exactly 45 cards and 21 llm-sd decks on exactly 25, regardless of how long the
 * source article was. A 10,085-word article and a 6,752-word one both got 45 cards, so the long
 * one's second half (deep dives, failure modes — the highest-signal interview material) was simply
 * dropped.
 *
 * This gate ties card count to source length: a deck must carry at least one card per
 * THRESHOLD words of its source article. It is deliberately a floor, not a target — density above
 * the floor is fine, and the median deck already sits near 85 words/card.
 *
 * Usage:
 *   node scripts/audit-coverage.mjs                     # all decks
 *   node scripts/audit-coverage.mjs --threshold=100     # stricter floor
 *   node scripts/audit-coverage.mjs src/content/system-design/deep-dives_kafka.json
 *
 * Exit code 1 when any deck is under-covered, so it can gate a build the same way
 * validate-deck.mjs does.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.resolve(ROOT, '../../atlas_page_scraper/output/clean');
const CONTENT = path.join(ROOT, 'src/content');

// source track dir -> deck dir under src/content
const TRACKS = {
  'system-design': 'system-design',
  'ml-system-design': 'llm-sd',
  'low-level-design': 'low-level-design',
  'ai-coding': 'ai-coding',
};

const DEFAULT_THRESHOLD = 120;

function parseArgs(argv) {
  let threshold = DEFAULT_THRESHOLD;
  const files = [];
  for (const a of argv.slice(2)) {
    const m = /^--threshold=(\d+)$/.exec(a);
    if (m) threshold = Number(m[1]);
    else if (!a.startsWith('--')) files.push(a);
  }
  return { threshold, files };
}

function countWords(file) {
  return fs.readFileSync(file, 'utf8').split(/\s+/).filter(Boolean).length;
}

function countCards(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data.length : (data.cards?.length ?? 0);
  } catch {
    return -1; // unreadable — report rather than silently pass
  }
}

function collect(onlyFiles) {
  const rows = [];
  for (const [srcTrack, deckTrack] of Object.entries(TRACKS)) {
    const srcDir = path.join(SRC, srcTrack);
    const deckDir = path.join(CONTENT, deckTrack);
    if (!fs.existsSync(srcDir) || !fs.existsSync(deckDir)) continue;
    for (const f of fs.readdirSync(srcDir)) {
      if (!f.endsWith('.md')) continue;
      const slug = f.slice(0, -3);
      const deckFile = path.join(deckDir, `${slug}.json`);
      if (!fs.existsSync(deckFile)) continue;
      if (onlyFiles.length) {
        const wanted = onlyFiles.some((o) => path.resolve(o) === deckFile);
        if (!wanted) continue;
      }
      const words = countWords(path.join(srcDir, f));
      const cards = countCards(deckFile);
      rows.push({ track: deckTrack, slug, deckFile, words, cards });
    }
  }
  return rows;
}

const { threshold, files } = parseArgs(process.argv);
const rows = collect(files);

if (!rows.length) {
  console.log('no deck matched a source article — nothing to check');
  process.exit(0);
}

const under = [];
for (const r of rows) {
  const required = Math.ceil(r.words / threshold);
  if (r.cards < required) under.push({ ...r, required, missing: required - r.cards });
}
under.sort((a, b) => b.missing - a.missing);

for (const u of under) {
  const density = u.cards > 0 ? Math.round(u.words / u.cards) : Infinity;
  console.log(
    `[coverage] ${path.relative(ROOT, u.deckFile)}\n` +
    `  source is ${u.words} words but the deck has ${u.cards} cards ` +
    `(${density} words/card, floor is ${threshold})\n` +
    `  add ${u.missing} more cards — target ${u.required}. ` +
    `Draw them from the parts of the article the deck skips (usually the deep-dive second ` +
    `half: failure modes, capacity math, follow-ups).\n`,
  );
}

const totalCards = rows.reduce((a, r) => a + Math.max(r.cards, 0), 0);
const totalWords = rows.reduce((a, r) => a + r.words, 0);
console.log(
  `${rows.length} decks · ${totalWords.toLocaleString()} source words · ${totalCards.toLocaleString()} cards ` +
  `· ${Math.round(totalWords / Math.max(totalCards, 1))} words/card overall`,
);
console.log(
  under.length
    ? `under-covered: ${under.length}/${rows.length} decks, ${under.reduce((a, u) => a + u.missing, 0)} cards short of the floor`
    : `coverage floor met by all ${rows.length} decks`,
);

process.exit(under.length ? 1 : 0);
