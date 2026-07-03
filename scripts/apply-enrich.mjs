#!/usr/bin/env node
/**
 * Apply enrichment patches (per-option explanations / diagrams) onto existing
 * deck files WITHOUT rewriting them from scratch. Agents only ever write patch
 * files under scripts/enrich-patches/; this script is the only thing that edits
 * decks, so existing card content cannot be lost.
 *
 * Patch file: scripts/enrich-patches/<track>__<deck-basename>.json
 *   { "<cardId>": { optionMeanings?, optionScenarioImpacts?, optionDirectness?, optionExplanations?, optionDiagrams?, diagram? }, ... }
 *
 * For each patched card we ONLY set the enrichment fields; every other field is
 * left byte-identical. Alignment (length === options.length) is enforced.
 *
 * Usage: node scripts/apply-enrich.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const contentDir = path.join(root, 'src', 'content');
const patchDir = path.join(__dirname, 'enrich-patches');

if (!fs.existsSync(patchDir)) { console.error('no enrich-patches/ dir'); process.exit(1); }

// index decks by basename -> abs path(s). Some basenames appear in multiple
// tracks, so bare legacy patch names are accepted only when unambiguous.
const decksByBase = new Map();
for (const track of fs.readdirSync(contentDir, { withFileTypes: true })) {
  if (!track.isDirectory()) continue;
  for (const f of fs.readdirSync(path.join(contentDir, track.name))) {
    if (!f.endsWith('.json')) continue;
    const paths = decksByBase.get(f) ?? [];
    paths.push(path.join(contentDir, track.name, f));
    decksByBase.set(f, paths);
  }
}

const patchFiles = fs.readdirSync(patchDir).filter((f) => f.endsWith('.json'));
const ENRICH_ARRAY_KEYS = [
  'optionMeanings',
  'optionScenarioImpacts',
  'optionDirectness',
  'optionMeanings_en',
  'optionScenarioImpacts_en',
  'optionDirectness_en',
  'optionExplanations',
  'optionExplanations_en',
  'optionDiagrams',
];
let decksTouched = 0, cardsEnriched = 0, problems = 0;
const touched = [];

for (const pf of patchFiles) {
  // Patch names are "<track>__<deckbasename>.json" (track-qualified to avoid
  // cross-track filename collisions). Fall back to bare-basename lookup for
  // legacy pilot patches.
  let deckPath;
  if (pf.includes('__')) {
    const stem = pf.replace(/\.json$/, '');
    const idx = stem.indexOf('__');
    const track = stem.slice(0, idx);
    const base = stem.slice(idx + 2) + '.json';
    const p = path.join(contentDir, track, base);
    if (fs.existsSync(p)) deckPath = p;
  } else {
    const matches = decksByBase.get(pf) ?? [];
    if (matches.length === 1) {
      deckPath = matches[0];
    } else if (matches.length > 1) {
      console.error(
        `  ! patch ${pf} is ambiguous; use <track>__${pf} for one of: ${matches
          .map((p) => path.relative(contentDir, p))
          .join(', ')}`,
      );
      problems++;
      continue;
    }
  }
  if (!deckPath) { console.error(`  ! no deck matches patch ${pf} — skipped`); problems++; continue; }
  const patch = JSON.parse(fs.readFileSync(path.join(patchDir, pf), 'utf8'));
  const cards = JSON.parse(fs.readFileSync(deckPath, 'utf8'));
  const byId = new Map(cards.map((c) => [c.id, c]));
  let n = 0;
  for (const [id, add] of Object.entries(patch)) {
    const card = byId.get(id);
    if (!card) { console.error(`  ! ${pf}: card id ${id} not in deck — skipped`); problems++; continue; }
    const optLen = Array.isArray(card.options) ? card.options.length : 0;
    let ok = true;
    for (const k of ENRICH_ARRAY_KEYS) {
      if (add[k] !== undefined) {
        if (!Array.isArray(add[k]) || add[k].length !== optLen) {
          console.error(`  ! ${pf}:${id}: ${k} length ${add[k]?.length} != options ${optLen} — skipped field`);
          problems++; ok = false; continue;
        }
      }
    }
    if (!ok) continue;
    for (const k of ENRICH_ARRAY_KEYS) if (add[k] !== undefined) card[k] = add[k];
    if (typeof add.diagram === 'string') card.diagram = add.diagram;
    n++;
  }
  if (n > 0) {
    fs.writeFileSync(deckPath, JSON.stringify(cards, null, 2) + '\n', 'utf8');
    decksTouched++; cardsEnriched += n; touched.push(path.relative(root, deckPath));
  }
}

console.log(`\napplied: ${cardsEnriched} cards enriched across ${decksTouched} decks (${problems} problem(s))`);

// validate the touched decks
if (touched.length) {
  console.log('\nvalidating touched decks…');
  try {
    const out = execFileSync('node', [path.join(__dirname, 'validate-deck.mjs'), ...touched], { cwd: root, encoding: 'utf8' });
    console.log(out);
  } catch (e) {
    console.error(e.stdout || e.message);
    process.exit(1);
  }
}
if (problems) process.exit(1);
