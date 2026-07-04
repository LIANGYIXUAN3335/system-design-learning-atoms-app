#!/usr/bin/env node
/**
 * Gate manually repaired decks and mark them passed in the backfill ledger.
 *
 * This is intentionally narrow: it validates the given deck files, requires
 * audit severity>=3 findings to be zero, then records the current rubric
 * version + stimulus hash for every card in those decks.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const ledgerPath = path.join(root, 'scripts', 'backfill-ledger.json');
const rubricPath = path.join(root, 'docs', 'card-quality-rubric.md');

const targets = process.argv.slice(2).map((p) => path.normalize(p));
if (targets.length === 0) {
  console.error('usage: node scripts/mark-backfill-passed.mjs src/content/<track>/<deck>.json [...]');
  process.exit(2);
}

const readJson = (p, dflt) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return dflt;
  }
};

const writeJson = (p, obj) => fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

function stimulusHash(card) {
  const norm = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v);
  return sha1(
    JSON.stringify({
      q: norm(card.q),
      scenario: norm(card.scenario ?? ''),
      options: (card.options ?? []).map(norm),
      answer: card.answer ?? null,
      text: norm(card.text ?? ''),
      steps: (card.steps ?? []).map(norm),
      answerOrder: card.answerOrder ?? null,
    }),
  );
}

function rubricVersion() {
  const head = fs.readFileSync(rubricPath, 'utf8').slice(0, 500);
  const m = head.match(/^version:\s*(\S+)/m);
  if (!m) throw new Error('rubric has no `version:` front-matter');
  return m[1];
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = (res.stdout ?? '') + (res.stderr ?? '');
  if ((res.status ?? -1) !== 0) {
    console.error(out);
    process.exit(res.status ?? 1);
  }
  return out;
}

for (const target of targets) {
  if (!fs.existsSync(path.join(root, target))) {
    console.error(`missing target: ${target}`);
    process.exit(2);
  }
}

run('node', ['scripts/validate-deck.mjs', ...targets]);
const auditOut = run('node', ['scripts/audit-card-quality.mjs', ...targets, '--json', '--limit=0']);
const jsonStart = auditOut.indexOf('{');
if (jsonStart < 0) {
  console.error('audit produced no JSON');
  process.exit(1);
}
const audit = JSON.parse(auditOut.slice(jsonStart));
const errors = (audit.selected ?? []).filter((f) => f.severity >= 3);
if (errors.length > 0) {
  console.error(`audit has ${errors.length} severity>=3 finding(s); not ledgering`);
  for (const f of errors.slice(0, 20)) console.error(`- ${f.file} :: ${f.id} :: ${f.category}`);
  process.exit(1);
}

const version = rubricVersion();
const ledger = readJson(ledgerPath, { rubricVersion: null, cards: {} });
let count = 0;

for (const target of targets) {
  const cards = readJson(path.join(root, target), []);
  if (!Array.isArray(cards)) {
    console.error(`not an array deck: ${target}`);
    process.exit(1);
  }
  for (const card of cards) {
    ledger.cards[card.id] = { v: version, hash: stimulusHash(card) };
    count++;
  }
}

ledger.rubricVersion = version;
writeJson(ledgerPath, ledger);
console.log(`marked ${count} cards passed for rubric ${version}`);
