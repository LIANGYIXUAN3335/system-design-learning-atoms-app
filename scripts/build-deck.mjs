#!/usr/bin/env node
/**
 * Build the app's runtime deck bundle by merging the original seed deck
 * (src/content/cards.json, 34 database cards) with every generated topic deck
 * under src/content/<topic>/*.json.
 *
 * Output: src/content/deck.bundle.json  (what App.tsx should import).
 * Keeps cards.json untouched so scripts/selftest.ts still passes.
 *
 * Usage: node scripts/build-deck.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contentDir = path.resolve(__dirname, '../src/content');
const seedFile = path.join(contentDir, 'cards.json');
const outFile = path.join(contentDir, 'deck.bundle.json');

/**
 * M2a (atoms-m2a-review.md §2.8): tracks consume `track:*` tags. They are
 * injected here — one visible map from content source to track — so the
 * source JSONs stay exactly as generated. Cards may also carry their own
 * explicit `track:*` tags; the union is deduplicated.
 */
const SEED_TRACK_TAG = 'track:classic-sd';
const SEED_TRACK_ID = 'classic-sd';
const SEED_CATEGORY = 'Databases';
const DIR_TRACK_TAG = {
  'system-design': 'track:classic-sd',
  'ai-coding': 'track:ai-coding',
  'llm-sd': 'track:llm-sd',
  'low-level-design': 'track:low-level-design',
  'interview-drill': 'track:interview-drill',
};
const DIR_TRACK_ID = {
  'system-design': 'classic-sd',
  'ai-coding': 'ai-coding',
  'llm-sd': 'llm-sd',
  'low-level-design': 'low-level-design',
  'interview-drill': 'interview-drill',
};

const CATEGORY_PREFIXES = [
  'core-concepts_',
  'deep-dives_',
  'problem-breakdowns_',
  'patterns_',
  'in-a-hurry_',
  'overview_',
  'fundamentals_',
];

const SCALABILITY_NUMBER_TAGS = new Set([
  'backpressure',
  'burst',
  'bursty-traffic',
  'capacity',
  'numbers',
  'partitioning',
  'partitions',
  'qps',
  'read-scaling',
  'scale',
  'scaling',
  'sharding',
  'throughput',
  'tps',
  'write-scaling',
]);
const SCALABILITY_NUMBER_SUBSTRINGS = [
  'capacity',
  'partition',
  'qps',
  'scale',
  'scaling',
  'shard',
  'throughput',
  'tps',
];
const SCALABILITY_NUMBER_CHEATSHEET =
  '数字小抄：先用平均 QPS/TPS × 峰值系数（常用 2-5x）估峰值；Redis 简单 GET/SET 约 100k+ ops/s/实例；单主 SQL 写事务常按 1k-10k+ TPS/主库估；Kafka 单 partition 常按 5k-10k msg/s 起算，靠 partitions/brokers 横向扩；API worker 吞吐取决于是否打 DB/外部 API；队列只能削峰和排队，不能提高下游真实处理能力。';
const SCALABILITY_NUMBER_CHEATSHEET_EN =
  'Capacity cheat sheet: estimate peak as average QPS/TPS times a peak factor, often 2-5x. A Redis instance can handle roughly 100k+ simple GET/SET ops/s; a single SQL primary is often reasoned about as 1k-10k+ write TPS; one Kafka partition is often estimated around 5k-10k msg/s, scaling with partitions and brokers. API worker throughput depends on DB or external calls. Queues smooth bursts but do not increase downstream capacity.';

const ACRONYM_WORDS = new Map([
  ['ai', 'AI'],
  ['api', 'API'],
  ['cap', 'CAP'],
  ['cdc', 'CDC'],
  ['db', 'DB'],
  ['fb', 'FB'],
  ['fsrs', 'FSRS'],
  ['gsi', 'GSI'],
  ['http', 'HTTP'],
  ['ia', 'IA'],
  ['llm', 'LLM'],
  ['lsi', 'LSI'],
  ['lru', 'LRU'],
  ['ml', 'ML'],
  ['oop', 'OOP'],
  ['qa', 'QA'],
  ['s3', 'S3'],
  ['sd', 'SD'],
  ['sql', 'SQL'],
  ['tcp', 'TCP'],
  ['ttl', 'TTL'],
  ['udp', 'UDP'],
  ['url', 'URL'],
]);

function titleWord(word) {
  const lower = word.toLowerCase();
  return ACRONYM_WORDS.get(lower) ?? `${lower.slice(0, 1).toUpperCase()}${lower.slice(1)}`;
}

function categoryFromFile(file) {
  let stem = file.replace(/\.json$/, '');
  for (const prefix of CATEGORY_PREFIXES) {
    if (stem.startsWith(prefix)) {
      stem = stem.slice(prefix.length);
      break;
    }
  }
  return stem
    .split(/[-_]+/)
    .filter(Boolean)
    .map(titleWord)
    .join(' ');
}

function hasScalabilitySignal(card) {
  if (card.track !== SEED_TRACK_ID) return false;
  const tags = (card.tags ?? []).map((tag) => String(tag).toLowerCase());
  if (tags.some((tag) => SCALABILITY_NUMBER_TAGS.has(tag))) return true;
  const sub = String(card.sub ?? '').toLowerCase();
  return SCALABILITY_NUMBER_SUBSTRINGS.some((needle) => sub.includes(needle));
}

function appendScalabilityNumberCheatsheet(card) {
  if (!hasScalabilitySignal(card)) return card;
  const next = { ...card };
  if (typeof next.why === 'string' && !next.why.includes('数字小抄：')) {
    next.why = `${next.why}\n\n${SCALABILITY_NUMBER_CHEATSHEET}`;
  }
  if (typeof next.why_en === 'string' && !next.why_en.includes('Capacity cheat sheet:')) {
    next.why_en = `${next.why_en}\n\n${SCALABILITY_NUMBER_CHEATSHEET_EN}`;
  }
  return next;
}

const merged = [];
const ids = new Set();
let dupes = 0;

function add(cards, label, meta = {}) {
  for (const c of cards) {
    if (ids.has(c.id)) { dupes++; console.error(`  ! duplicate id ${c.id} (from ${label}) skipped`); continue; }
    ids.add(c.id);
    const next = { ...c };
    if (meta.track) next.track = meta.track;
    if (meta.category) next.category = meta.category;
    if (meta.trackTag) next.tags = [...new Set([...(next.tags ?? []), meta.trackTag])];
    merged.push(appendScalabilityNumberCheatsheet(next));
  }
}

// 1) seed deck first (keeps db-* cards at the front, matching current app order)
if (fs.existsSync(seedFile)) {
  add(JSON.parse(fs.readFileSync(seedFile, 'utf8')), 'cards.json', {
    trackTag: SEED_TRACK_TAG,
    track: SEED_TRACK_ID,
    category: SEED_CATEGORY,
  });
}

// 2) every topic subfolder, alphabetically, files alphabetically within
const topics = fs.readdirSync(contentDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();
const perTopic = {};
for (const topic of topics) {
  const dir = path.join(contentDir, topic);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  let n = 0;
  for (const f of files) {
    const cards = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    add(cards, `${topic}/${f}`, {
      trackTag: DIR_TRACK_TAG[topic],
      track: DIR_TRACK_ID[topic],
      category: categoryFromFile(f),
    });
    n += cards.length;
  }
  perTopic[topic] = n;
}

// sanity: every bundled card must carry at least one tag (tracks filter on tags)
const untagged = merged.filter((c) => !Array.isArray(c.tags) || c.tags.length === 0);
if (untagged.length) {
  console.error(`\n${untagged.length} card(s) have no tags: ${untagged.slice(0, 5).map((c) => c.id).join(', ')}…`);
  process.exit(1);
}

fs.writeFileSync(outFile, JSON.stringify(merged, null, 2) + '\n', 'utf8');

console.log(`\nbundle: ${merged.length} cards -> ${path.relative(path.resolve(__dirname, '..'), outFile)}`);
console.log('  seed (cards.json):', ids.size ? merged.filter((c) => c.id.startsWith('db-')).length : 0);
for (const [t, n] of Object.entries(perTopic)) console.log(`  ${t}:`, n);
const trackCounts = {};
for (const c of merged)
  for (const t of c.tags) if (t.startsWith('track:')) trackCounts[t] = (trackCounts[t] ?? 0) + 1;
console.log('  by track:', JSON.stringify(trackCounts));
if (dupes) { console.error(`\n${dupes} duplicate id(s) skipped — fix before shipping`); process.exit(1); }
