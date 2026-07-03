#!/usr/bin/env node
/**
 * Validate Mermaid specs used by card-level diagrams and option diagrams.
 *
 * Usage:
 *   node scripts/validate-visuals.mjs
 *   node scripts/validate-visuals.mjs src/content/deck.bundle.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const files = process.argv.slice(2);
const targets = files.length ? files : ['src/content/deck.bundle.json'];

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });

const mermaid = (await import('mermaid')).default;
mermaid.initialize({ startOnLoad: false });

function readCards(rel) {
  const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
  const cards = JSON.parse(fs.readFileSync(abs, 'utf8'));
  if (!Array.isArray(cards)) throw new Error(`${rel}: top-level JSON is not an array`);
  return cards;
}

function specsForCard(card) {
  const specs = [];
  if (card.diagram) specs.push({ label: 'diagram', spec: card.diagram });
  if (Array.isArray(card.optionDiagrams)) {
    card.optionDiagrams.forEach((spec, index) => {
      if (typeof spec === 'string' && spec.trim()) specs.push({ label: `optionDiagrams[${index}]`, spec });
    });
  }
  return specs;
}

let checked = 0;
let errors = 0;

for (const file of targets) {
  for (const card of readCards(file)) {
    for (const { label, spec } of specsForCard(card)) {
      checked++;
      try {
        await mermaid.parse(spec);
      } catch (e) {
        errors++;
        const message = e instanceof Error ? e.message : String(e);
        console.error(`  ✗ ${file} ${card.id} ${label}: ${message.split('\n')[0]}`);
      }
    }
  }
}

if (errors) {
  console.error(`\n${errors} Mermaid error(s), checked ${checked} visual spec(s)`);
  process.exit(1);
}

console.log(`all Mermaid specs valid ✓ (${checked} checked)`);
