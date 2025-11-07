#!/usr/bin/env node
/**
 * Audit visual coverage in the authored decks and runtime bundle.
 *
 * Usage:
 *   node scripts/visual-audit.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const contentDir = path.join(root, 'src/content');
const bundleFile = path.join(contentDir, 'deck.bundle.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function walkJson(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJson(abs));
    else if (entry.name.endsWith('.json')) out.push(abs);
  }
  return out;
}

function hasOptionDiagram(card) {
  return Array.isArray(card.optionDiagrams) && card.optionDiagrams.some((spec) => typeof spec === 'string' && spec.trim());
}

function count(cards) {
  const stats = { n: cards.length, diagram: 0, table: 0, optionDiagrams: 0, visual: 0 };
  for (const card of cards) {
    const hasDiagram = Boolean(card.diagram);
    const hasTable = Boolean(card.table);
    const hasOption = hasOptionDiagram(card);
    if (hasDiagram) stats.diagram++;
    if (hasTable) stats.table++;
    if (hasOption) stats.optionDiagrams++;
    if (hasDiagram || hasTable || hasOption) stats.visual++;
  }
  return stats;
}

function pct(num, den) {
  return den ? `${((num / den) * 100).toFixed(1)}%` : '0.0%';
}

function row(label, stats) {
  return [
    label,
    `cards=${stats.n}`,
    `visual=${stats.visual} (${pct(stats.visual, stats.n)})`,
    `diagram=${stats.diagram}`,
    `table=${stats.table}`,
    `optionDiagrams=${stats.optionDiagrams}`,
  ].join('\t');
}

const sourceFiles = walkJson(contentDir)
  .filter((file) => !['cards.json', 'deck.bundle.json', 'tracks.json'].includes(path.basename(file)))
  .sort();

console.log('By track');
const bundle = readJson(bundleFile);
const byTrack = new Map();
for (const card of bundle) {
  const track = card.tags?.find((tag) => tag.startsWith('track:')) ?? 'track:?';
  const cards = byTrack.get(track) ?? [];
  cards.push(card);
  byTrack.set(track, cards);
}
for (const [track, cards] of [...byTrack.entries()].sort()) {
  console.log(row(track, count(cards)));
}
console.log(row('TOTAL', count(bundle)));

console.log('\nLowest visual coverage files');
const perFile = sourceFiles
  .map((file) => {
    const rel = path.relative(root, file);
    const stats = count(readJson(file));
    return { rel, stats };
  })
  .filter(({ stats }) => stats.n >= 25)
  .sort((a, b) => a.stats.visual / a.stats.n - b.stats.visual / b.stats.n || b.stats.n - a.stats.n);

for (const { rel, stats } of perFile.slice(0, 40)) {
  console.log(row(rel, stats));
}
