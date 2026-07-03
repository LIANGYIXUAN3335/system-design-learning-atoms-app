#!/usr/bin/env node
/**
 * Port the M0 drill prototypes (content/*.html CARDS arrays) into canonical
 * deck JSON files. M2a: three sources, all normalized to the M1 canonical
 * schema (atoms-m1-review.md §2.1) and TAGGED (atoms-m2a-review.md §1).
 *
 *   databases-drill.html                → src/content/cards.json                              (34, the M1 seed — path kept so selftest invariants hold)
 *   ai-agents-drill.html                → src/content/ai-coding/ai-agents.json                (11)
 *   consistency-replication-drill.html  → src/content/system-design/consistency-replication.json (6)
 *
 * Normalization: en→why_en · other→whenOtherWins · opts→options; diagram and
 * structured table ({headers, rows}) pass through. tags = [baseTag, sub].
 * track:* tags are NOT set here — build-deck.mjs injects them by source dir.
 *
 * Run: npm run port:cards   (then: npm run build:deck)
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT = path.resolve(__dirname, '../../content');
const OUT_ROOT = path.resolve(__dirname, '../src/content');

/** Disclosed content additions from M1 (diagrams for two db cards). */
const PATCHES = {
  'db-017': {
    diagram: `sequenceDiagram
    participant App as 应用
    participant Cache as 缓存
    participant DB as 数据库
    App->>Cache: 写入 x
    Cache->>DB: 同步写入 x
    DB-->>Cache: OK
    Cache-->>App: OK
    Note over Cache,DB: 两边始终一致，代价是写路径多一步`,
  },
  'db-024': {
    diagram: `flowchart LR
    R["需求：热点反复读<br/>延迟敏感"] --> C["选型：Redis 缓存"]
    C --> K["代价：可能读到旧数据"]
    K --> M["缓解：TTL + 写穿透"]`,
  },
};

const SOURCES = [
  { html: 'databases-drill.html', topic: 'databases', baseTag: 'databases', out: 'cards.json' },
  { html: 'ai-agents-drill.html', topic: 'ai-coding', baseTag: 'ai-agents', out: 'ai-coding/ai-agents.json' },
  { html: 'consistency-replication-drill.html', topic: 'system-design', baseTag: 'replication', out: 'system-design/consistency-replication.json' },
];

const FORMATS = ['mcq', 'multi', 'cloze', 'chain', 'code'];
const ATOM_TYPES = ['fact', 'fit', 'contrast', 'consequence', 'number'];

function extract(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const m = html.match(/const CARDS = (\[[\s\S]*?\n\]);/);
  if (!m) throw new Error('Could not locate `const CARDS = [...]` in ' + htmlPath);
  return vm.runInNewContext('(' + m[1] + ')');
}

function normalize(c, src) {
  const out = {
    id: c.id,
    format: c.format,
    atomType: c.atomType,
    topic: src.topic,
    sub: c.sub,
    scenario: c.scenario,
    q: c.q,
    options: c.opts,
    answer: c.answer,
    text: c.text,
    steps: c.steps,
    answerOrder: c.answerOrder,
    acceptAltOrders: c.acceptAltOrders,
    why: c.why,
    why_en: c.en,
    whenOtherWins: c.other,
    codeSample: c.codeSample,
    lang: c.lang,
    diagram: c.diagram,
    table: c.table,
    tags: [...new Set([src.baseTag, c.sub].filter(Boolean))],
    origin: 'seed',
    ...(PATCHES[c.id] ?? {}),
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

function fail(msg) {
  console.error('VALIDATION FAILED: ' + msg);
  process.exit(1);
}

function validate(cards, label) {
  const ids = new Set();
  for (const c of cards) {
    const where = `${label}:${c.id ?? '<no id>'}`;
    if (!c.id || ids.has(c.id)) fail(`duplicate/missing id at ${where}`);
    ids.add(c.id);
    if (!FORMATS.includes(c.format)) fail(`${where}: bad format ${c.format}`);
    if (!ATOM_TYPES.includes(c.atomType)) fail(`${where}: bad atomType ${c.atomType}`);
    if (!c.q) fail(`${where}: missing q`);
    if (!c.why || !c.why_en) fail(`${where}: missing why / why_en`);
    if (!Array.isArray(c.tags) || c.tags.length === 0) fail(`${where}: missing tags`);
    if (c.format === 'mcq' || c.format === 'multi' || c.format === 'code') {
      if (!Array.isArray(c.options) || c.options.length < 2) fail(`${where}: needs options`);
      if (!Array.isArray(c.answer) || c.answer.length < 1) fail(`${where}: needs answer[]`);
      if (c.answer.some((a) => a < 0 || a >= c.options.length)) fail(`${where}: answer out of range`);
      if (c.format !== 'multi' && c.answer.length !== 1) fail(`${where}: single-answer format with ${c.answer.length} answers`);
    }
    if (c.format === 'cloze') {
      if (!c.text || !/\{\{.+?\}\}/.test(c.text)) fail(`${where}: cloze needs {{blanks}}`);
    }
    if (c.format === 'chain') {
      if (!Array.isArray(c.steps) || c.steps.length < 2) fail(`${where}: chain needs steps`);
      const sorted = [...(c.answerOrder ?? [])].sort((a, b) => a - b);
      if (sorted.length !== c.steps.length || sorted.some((v, i) => v !== i))
        fail(`${where}: answerOrder must be a permutation of 0..${c.steps.length - 1}`);
      for (const alt of c.acceptAltOrders ?? []) {
        const s = [...alt].sort((a, b) => a - b);
        if (s.length !== c.steps.length || s.some((v, i) => v !== i)) fail(`${where}: bad acceptAltOrders entry`);
      }
    }
    if (c.table !== undefined) {
      const t = c.table;
      const ok =
        t && typeof t === 'object' && Array.isArray(t.headers) && t.headers.length > 0 &&
        Array.isArray(t.rows) &&
        t.rows.every((r) => Array.isArray(r) && r.length === t.headers.length);
      if (!ok) fail(`${where}: table must be {headers, rows[]} with row widths matching headers`);
    }
  }
}

for (const src of SOURCES) {
  const raw = extract(path.join(CONTENT, src.html));
  const cards = raw.map((c) => normalize(c, src));
  validate(cards, src.html);
  const outPath = path.join(OUT_ROOT, src.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(cards, null, 2) + '\n');
  const nDiagram = cards.filter((c) => c.diagram).length;
  const nTable = cards.filter((c) => c.table).length;
  console.log(`${src.html} -> ${src.out}: ${cards.length} cards (diagram ${nDiagram}, table ${nTable})`);
}
console.log('\nnext: npm run build:deck   # merge everything into deck.bundle.json');
