#!/usr/bin/env node
// Deck-level length-bias monitor (read-only).
//
// The per-card audit rule `answer_cue.longest_option` (audit-card-quality.mjs) can
// only judge one card at a time. But "the correct option is the longest" is really a
// DISTRIBUTION property: across the deck it should sit near the random baseline
// (~1/optionCount). This reporter measures that rate overall and per track so a
// systematic length tell shows up even when most individual cards pass the per-card gate.
//
// Usage: node scripts/audit-length-bias.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = path.join(root, 'src/content/deck.bundle.json');
const raw = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
const cards = Array.isArray(raw) ? raw : raw.cards;

const isSingleMcq = (c) =>
  c.format === 'mcq' &&
  Array.isArray(c.options) &&
  c.options.length >= 3 &&
  Array.isArray(c.answer) &&
  c.answer.length === 1;

function stats(list) {
  let n = 0;
  let longest = 0;
  let rankSum = 0;
  let baselineSum = 0;
  for (const c of list) {
    const lens = c.options.map((o) => (o || '').length);
    const clen = lens[c.answer[0]];
    if (clen === Math.max(...lens)) longest++;
    rankSum += lens.filter((l) => l > clen).length; // 0 = correct is the longest
    baselineSum += 1 / c.options.length; // expected P(correct=longest) under random
    n++;
  }
  return { n, longest, rankSum, baselineSum };
}

function fmt(s) {
  const rate = (100 * s.longest) / s.n;
  const base = (100 * s.baselineSum) / s.n;
  const avgRank = s.rankSum / s.n;
  const flag = rate > 40 ? '  <-- length tell' : '';
  return `correct=longest ${rate.toFixed(0)}% (random ~${base.toFixed(0)}%) · avg #longer-than-correct ${avgRank.toFixed(2)} · n=${s.n}${flag}`;
}

const mcq = cards.filter(isSingleMcq);
const byTrack = new Map();
for (const c of mcq) {
  const t = c.track || '(no track)';
  if (!byTrack.has(t)) byTrack.set(t, []);
  byTrack.get(t).push(c);
}

console.log('== length-bias: is the correct option the longest? (single-answer MCQ) ==\n');
console.log(`${'OVERALL'.padEnd(26)}${fmt(stats(mcq))}\n`);
for (const [t, list] of [...byTrack].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${String(t).padEnd(26)}${fmt(stats(list))}`);
}
console.log(
  '\ntarget: correct=longest rate should approach the random baseline; >~40% signals a systematic length tell.',
);
