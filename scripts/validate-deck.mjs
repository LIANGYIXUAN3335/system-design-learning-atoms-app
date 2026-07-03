#!/usr/bin/env node
/**
 * Validate generated deck JSON files against the app's canonical Card schema
 * (mirrors the invariants in scripts/selftest.ts, but for any deck file).
 *
 * Usage:
 *   node scripts/validate-deck.mjs src/content/system-design/*.json
 *   node scripts/validate-deck.mjs            # defaults to all system-design decks
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { glob } from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const FORMATS = new Set(['mcq', 'multi', 'cloze', 'chain', 'code']);
const ATOM_TYPES = new Set(['fact', 'fit', 'contrast', 'consequence', 'number']);
const LEGACY = ['en', 'other', 'opts', 'prompt', 'answerIndex'];
const OPTION_STRING_ARRAY_KEYS = [
  'optionMeanings',
  'optionScenarioImpacts',
  'optionDirectness',
  'optionMeanings_en',
  'optionScenarioImpacts_en',
  'optionDirectness_en',
  'optionExplanations',
  'optionExplanations_en',
];

let files = process.argv.slice(2);
if (files.length === 0) {
  files = [];
  for await (const f of glob('src/content/system-design/*.json', { cwd: root })) files.push(f);
  files.sort();
}

const seenIds = new Set();
let cardCount = 0;
let errors = 0;
const byFormat = {};
const byTopic = {};

function err(file, id, msg) {
  errors++;
  console.error(`  ✗ [${file}${id ? ' ' + id : ''}] ${msg}`);
}

function cloze_blanks(text) {
  return (text || '').match(/\{\{(.+?)\}\}/g) || [];
}

for (const rel of files) {
  const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
  let cards;
  try {
    cards = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (e) {
    err(rel, '', `JSON parse failed: ${e.message}`);
    continue;
  }
  if (!Array.isArray(cards)) { err(rel, '', 'top-level is not an array'); continue; }
  const base = path.basename(rel);
  for (const c of cards) {
    cardCount++;
    byFormat[c.format] = (byFormat[c.format] || 0) + 1;
    byTopic[c.topic] = (byTopic[c.topic] || 0) + 1;
    const id = c.id || '(no id)';
    if (!c.id) err(base, '', 'missing id');
    else if (seenIds.has(c.id)) err(base, id, 'duplicate id (global)');
    else seenIds.add(c.id);

    if (!FORMATS.has(c.format)) err(base, id, `bad format: ${c.format}`);
    if (!ATOM_TYPES.has(c.atomType)) err(base, id, `bad atomType: ${c.atomType}`);
    if (!c.topic) err(base, id, 'missing topic');
    if (!c.sub) err(base, id, 'missing sub');
    if (!c.q) err(base, id, 'missing q');
    if (!c.why) err(base, id, 'missing why');
    if (!c.why_en) err(base, id, 'missing why_en');
    for (const k of LEGACY) if (k in c) err(base, id, `legacy field present: ${k}`);
    if (c.termDefinitions !== undefined) {
      if (!Array.isArray(c.termDefinitions)) err(base, id, 'termDefinitions must be an array');
      else {
        for (const [i, term] of c.termDefinitions.entries()) {
          if (!term || typeof term !== 'object') err(base, id, `termDefinitions[${i}] must be an object`);
          else {
            if (typeof term.term !== 'string' || !term.term.trim()) err(base, id, `termDefinitions[${i}].term must be a non-empty string`);
            if (typeof term.meaning !== 'string' || !term.meaning.trim()) err(base, id, `termDefinitions[${i}].meaning must be a non-empty string`);
            if (term.meaningEn !== undefined && typeof term.meaningEn !== 'string') err(base, id, `termDefinitions[${i}].meaningEn must be a string`);
          }
        }
      }
    }

    if (c.format === 'mcq' || c.format === 'code') {
      const n = c.options?.length ?? 0;
      if (n < 2) err(base, id, 'needs >=2 options');
      if (!(c.answer?.length === 1)) err(base, id, 'single-answer format needs exactly 1 answer');
      else if (c.answer[0] < 0 || c.answer[0] >= n) err(base, id, `answer index ${c.answer[0]} out of range`);
    }
    if (c.format === 'multi') {
      const n = c.options?.length ?? 0;
      if (n < 2) err(base, id, 'needs >=2 options');
      if (!(c.answer?.length >= 1)) err(base, id, 'multi needs >=1 answer');
      for (const a of c.answer || []) if (a < 0 || a >= n) err(base, id, `answer index ${a} out of range`);
    }
    if (c.optionDiagrams !== undefined) {
      if (!Array.isArray(c.optionDiagrams)) err(base, id, 'optionDiagrams must be an array');
      else if (!Array.isArray(c.options)) err(base, id, 'optionDiagrams requires options');
      else if (c.optionDiagrams.length !== c.options.length)
        err(base, id, 'optionDiagrams length must match options length');
      else {
        for (const [i, spec] of c.optionDiagrams.entries()) {
          if (spec !== null && typeof spec !== 'string') err(base, id, `optionDiagrams[${i}] must be string or null`);
        }
      }
    }
    for (const key of OPTION_STRING_ARRAY_KEYS) {
      if (c[key] !== undefined) {
        if (!Array.isArray(c[key])) err(base, id, `${key} must be an array`);
        else if (!Array.isArray(c.options)) err(base, id, `${key} requires options`);
        else if (c[key].length !== c.options.length) err(base, id, `${key} length must match options length`);
        else {
          for (const [i, explanation] of c[key].entries()) {
            if (typeof explanation !== 'string') err(base, id, `${key}[${i}] must be a string`);
          }
        }
      }
    }
    if (c.format === 'cloze') {
      if (cloze_blanks(c.text).length < 1) err(base, id, 'cloze needs >=1 {{blank}}');
    }
    if (c.format === 'chain') {
      const steps = c.steps || [];
      const order = c.answerOrder || [];
      const sorted = [...order].sort((a, b) => a - b);
      const isPerm = sorted.length === steps.length && sorted.every((v, i) => v === i);
      if (steps.length < 2) err(base, id, 'chain needs >=2 steps');
      if (!isPerm) err(base, id, 'answerOrder is not a permutation of steps');
      for (const alt of c.acceptAltOrders || []) {
        const s2 = [...alt].sort((a, b) => a - b);
        if (!(s2.length === steps.length && s2.every((v, i) => v === i)))
          err(base, id, 'acceptAltOrders entry is not a permutation');
      }
    }
    if (c.atomType === 'fit' && (c.format === 'mcq' || c.format === 'code') && !c.scenario)
      err(base, id, 'fit choice card should lead with a scenario');
  }
}

console.log(`\nfiles: ${files.length}  cards: ${cardCount}`);
console.log('by format:', JSON.stringify(byFormat));
console.log('by topic :', JSON.stringify(byTopic));
if (errors) {
  console.error(`\n${errors} error(s) — deck INVALID`);
  process.exit(1);
} else {
  console.log('\nall cards valid ✓');
}
