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
 * M2a (docs/history/m2a-review.md §2.8): tracks consume `track:*` tags. They are
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
  'interview-review': 'track:interview-review',
  'interview-english': 'track:interview-english',
  'cli': 'track:cli',
  'pmle': 'track:pmle',
};
const DIR_TRACK_ID = {
  'system-design': 'classic-sd',
  'ai-coding': 'ai-coding',
  'llm-sd': 'llm-sd',
  'low-level-design': 'low-level-design',
  'interview-drill': 'interview-drill',
  'interview-review': 'interview-review',
  'interview-english': 'interview-english',
  'cli': 'cli',
  'pmle': 'pmle',
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

const NUMBER_ANCHORS = {
  sql: {
    system: 'Postgres/MySQL',
    unit: 'primary / replica / shard',
    estimate: '读 10k-50k TPS；写 10k-20k TPS',
    risk: '单主写瓶颈、索引/事务变重',
  },
  redis: {
    system: 'Redis',
    unit: 'instance / shard',
    estimate: '100k-200k+ simple ops/s',
    risk: '大 value、Lua、ZSET、网络带宽',
  },
  kafka: {
    system: 'Kafka',
    unit: 'partition / broker',
    estimate: 'broker 0.3M-1M msg/s；partition 10k-50k msg/s',
    risk: 'hot partition、batch 太小',
  },
  dynamodb: {
    system: 'DynamoDB',
    unit: 'physical partition',
    estimate: '3k RCU / 1k WCU 每物理分区',
    risk: 'AWS 管扩展，但 hot key 仍会限流',
  },
  cassandra: {
    system: 'Cassandra',
    unit: 'node / token range',
    estimate: '10k-50k ops/s per node 粗估',
    risk: 'wide partition、tombstone、repair/compaction',
  },
  mongodb: {
    system: 'MongoDB',
    unit: 'shard key / shard',
    estimate: '10k-50k ops/s per shard 粗估',
    risk: 'shard key 选错导致 scatter query',
  },
  elastic: {
    system: 'Elasticsearch/OpenSearch',
    unit: 'primary shard / replica / node',
    estimate: '先按 10-50GB/shard，不背单 shard QPS',
    risk: 'oversharding、复杂查询 fan-out',
  },
  cockroachdb: {
    system: 'CockroachDB',
    unit: 'range / replica / node',
    estimate: 'range max 512MiB；默认 3 replicas',
    risk: 'Raft quorum、hot range、事务冲突',
  },
  clickhouse: {
    system: 'ClickHouse',
    unit: 'shard / replica / part',
    estimate: '批量写 >=1k rows；理想 10k-100k rows',
    risk: 'too many parts、merge backlog、分区键过细',
  },
};

const NUMBER_ANCHOR_MATCHERS = [
  ['sql', /\b(Postgres|PostgreSQL|MySQL|RDBMS|Aurora|RDS)\b|关系型数据库|关系数据库|单主 SQL|SQL 主库/i],
  ['redis', /\bRedis\b/i],
  ['kafka', /\bKafka\b/i],
  ['dynamodb', /\bDynamoDB\b/i],
  ['cassandra', /\bCassandra\b/i],
  ['mongodb', /\bMongoDB\b/i],
  ['elastic', /\b(Elasticsearch|OpenSearch)\b/i],
  ['cockroachdb', /\bCockroachDB\b/i],
  ['clickhouse', /\bClickHouse\b/i],
];

const SCALABILITY_SIGNAL =
  /scal|scale|scaling|扩展|扩容|吞吐|QPS|TPS|ops\/s|msg\/s|capacity|容量|分片|shard|partition|hot partition|hot key|热分区|热 key|热点|瓶颈|bottleneck|fan-?out|write-heavy|read-heavy|高写|高读|写入放大|读放大|高并发|throughput|broker|replica|副本|primary|主库|节点|node|单机|单实例|物理分区|宽分区|wide partition|tombstone|compaction|oversharding|scatter|scatter-gather|峰值|负载|load|OLAP|MPP|analytics|分析|列式|数仓|rollup|materialized view|物化视图|batch|批量|MergeTree|part|parts|range|Raft|quorum/i;

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

function stripOrderingPrefix(stem) {
  return stem.replace(/^\d{2,4}[-_\s]+/, '');
}

/**
 * Explicit category names, keyed by `<topic>/<file>`. Auto-titling a filename
 * gives English labels ("Bq Stories"), which reads wrong inside a Chinese-facing
 * track. The 面试复盘 track names its categories after the failure mode being
 * drilled, ordered roughly by how early it bites in an interview.
 */
const CATEGORY_OVERRIDES = {
  'llm-sd/agentic-frameworks_langchain-stack.json': 'Agentic Building Effective Agents',
  'llm-sd/agentic-durability_temporal.json': 'Agentic Building Effective Agents',
  'llm-sd/agentic-streaming_resumable.json': 'Agentic Building Effective Agents',
  'llm-sd/agentic-rag_retrieval-completeness.json': 'Agentic Building Effective Agents',
  'interview-review/openers-and-narrative.json': '开场与叙事',
  'interview-review/questions-and-reading-the-room.json': '反问与读空气',
  'interview-review/red-flags-and-delivery.json': '红旗与表达习惯',
  'interview-review/bq-stories.json': 'BQ 故事库',
  'interview-review/structure-first.json': '先骨架后细节',
  'interview-review/system-design-drills.json': '系统设计复盘',
  'interview-review/coding-reflexes.json': '编码反射',
  'interview-review/knowledge-gaps.json': '知识短板',
};

// These are one study module even though their source files belong to two
// tracks. The card-level override keeps the source files intact while making
// the interview workflow discoverable from the AI coding track.
const CORE_AGENT_CATEGORY = 'Agent 核心 · Loop / When / Patterns / vs Call';
const CARD_OVERRIDES = {
  'ag-002': { category: CORE_AGENT_CATEGORY },
  'ag-003': { category: CORE_AGENT_CATEGORY },
  'ag-004': { category: CORE_AGENT_CATEGORY },
  'llm-recap-ford-2026-07-31-004': {
    category: CORE_AGENT_CATEGORY,
    trackTags: ['track:ai-coding'],
  },
  'llm-recap-ford-2026-07-31-005': {
    category: CORE_AGENT_CATEGORY,
    trackTags: ['track:ai-coding'],
  },
};

function categoryFromFile(file, topic) {
  const override = CATEGORY_OVERRIDES[`${topic}/${file}`];
  if (override) return override;
  let stem = file.replace(/\.json$/, '');
  for (const prefix of CATEGORY_PREFIXES) {
    if (stem.startsWith(prefix)) {
      stem = stem.slice(prefix.length);
      break;
    }
  }
  stem = stripOrderingPrefix(stem);
  return stem
    .split(/[-_]+/)
    .filter(Boolean)
    .map(titleWord)
    .join(' ');
}

function searchableCardText(card) {
  return [
    card.id,
    card.sub,
    card.scenario,
    card.q,
    Array.isArray(card.options) ? card.options.join(' ') : '',
    card.text,
    Array.isArray(card.steps) ? card.steps.join(' ') : '',
    card.why,
    card.whenOtherWins,
    Array.isArray(card.tags) ? card.tags.join(' ') : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function matchingNumberAnchors(card) {
  if (card.track !== SEED_TRACK_ID) return [];
  const text = searchableCardText(card);
  if (!SCALABILITY_SIGNAL.test(text)) return [];

  const keys = NUMBER_ANCHOR_MATCHERS.filter(([, matcher]) => matcher.test(text)).map(([key]) => key);
  return [...new Set(keys)].map((key) => NUMBER_ANCHORS[key]);
}

function attachNumberAnchors(card) {
  const anchors = matchingNumberAnchors(card);
  if (!anchors.length) return card;

  const existing = Array.isArray(card.numberAnchors) ? card.numberAnchors : [];
  const bySystem = new Map(existing.map((anchor) => [anchor.system, anchor]));
  for (const anchor of anchors) bySystem.set(anchor.system, anchor);
  return { ...card, numberAnchors: [...bySystem.values()] };
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
    const cardOverride = CARD_OVERRIDES[next.id];
    if (cardOverride?.category) next.category = cardOverride.category;
    if (cardOverride?.trackTags) {
      next.tags = [...new Set([...(next.tags ?? []), ...cardOverride.trackTags])];
    }
    merged.push(attachNumberAnchors(next));
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
      category: categoryFromFile(f, topic),
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
