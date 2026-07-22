export const meta = {
  name: 'atoms-expand-spoken-tech',
  description: 'Full-coverage expansion of the spoken-technical-English track: vernacular + think-out-loud + structuring',
  phases: [
    { title: 'Write', detail: 'agents with EXPLICIT disjoint term/scenario assignments (no collisions)' },
    { title: 'Verify', detail: 'dedup check, rebuild bundle, audit' },
  ],
}

const ROOT = '/Users/yixuanliang/interview/Job_Search/system design learning/atoms-app'

// ---- LAYER 1: vernacular. Each agent owns a DISJOINT explicit term list (already-covered terms
// excluded up front). This structural assignment is what prevents the read-path collision recurring.
const VERN = [
  { key: 'vern-distributed-2', name: '分布式(进阶)', terms: [
    'consistent hashing (ring, minimizes reshuffle when a node joins/leaves)',
    'leader election (one node is elected leader; others follow)',
    'split-brain (two nodes both think they are leader after a partition)',
    'a coordination service like ZooKeeper (leader lease, config, membership)',
    'two-phase commit vs a saga (distributed transaction across services)',
    'CAP — under a partition you pick consistency or availability (CP vs AP)',
    'heartbeat / lease (a node proves it is alive; miss it and it is evicted)',
    'rebalancing / data locality (move partitions to even out load)',
  ] },
  { key: 'vern-storage-db-2', name: '存储/数据库(进阶)', terms: [
    'isolation levels — serializable vs read-committed (ACID)',
    'a B-tree index vs a full table scan',
    'a secondary index vs the primary key',
    'normalize vs denormalize (the read/write tradeoff)',
    'a connection pool (reuse DB connections instead of opening per request)',
    'compaction (merge SSTable segments, drop tombstones)',
    'hot vs cold storage tiering',
    'partition by range vs by hash',
    'a materialized view (precomputed query result)',
  ] },
  { key: 'vern-caching-2', name: '缓存(进阶)', terms: [
    'a CDN / edge cache (serve static assets close to the user)',
    'write-through vs write-back cache',
    'LRU vs LFU eviction',
    'warm the cache / pre-warm before a launch',
    'cache invalidation (the hard part — keep cache and source in sync)',
    'negative caching (cache the "not found" too)',
    'add TTL jitter so entries don\'t all expire at once',
  ] },
  { key: 'vern-queue-stream-2', name: '队列/流(进阶)', terms: [
    'a consumer group (partitions split across consumers)',
    'exactly-once vs at-least-once delivery',
    'a dead-letter queue for messages that keep failing',
    'the partition key controls ordering (same key → same partition, in order)',
    'stream processing with a tumbling/sliding window and a watermark',
    'replay / reprocess from an earlier offset',
    'an idempotent consumer (safe to reprocess a duplicate)',
    'micro-batching (buffer a few then write once)',
  ] },
  { key: 'vern-concurrency-2', name: '并发(进阶)', terms: [
    'a deadlock, and fixing it by imposing a lock ordering',
    'compare-and-swap (CAS) for a lock-free update',
    'a semaphore to cap concurrent access',
    'thread pool sizing (too few starve, too many thrash)',
    'a read-write lock (many readers or one writer)',
    'an atomic counter instead of a lock',
    'thread confinement / an actor owning its state',
  ] },
  { key: 'vern-scale-reliability-2', name: '扩展/可靠性(进阶)', terms: [
    'a rate limiter — token bucket vs leaky bucket',
    'an L4 vs L7 load balancer',
    'autoscaling on a signal like CPU or queue depth',
    'an SLO and an error budget',
    'a readiness vs liveness health check',
    'timeout with deadline propagation across services',
    'a canary or blue-green deploy',
    'load shedding low-priority traffic under overload',
  ] },
  { key: 'vern-api-network-2', name: 'API/网络(进阶)', terms: [
    'an API gateway (auth, routing, rate-limit at the edge)',
    'gRPC vs REST (binary contract vs JSON over HTTP)',
    'GraphQL and over-fetching / the N+1 problem',
    'a webhook (server calls you) vs polling',
    'an idempotent PUT so a retry is safe',
    'API versioning (don\'t break existing clients)',
    'mTLS between services',
    'request coalescing / dedup of identical in-flight calls',
  ] },
  { key: 'vern-ml-systems', name: 'ML/AI 系统术语', terms: [
    'RAG — retrieve relevant chunks, then generate grounded in them',
    'semantic search over embeddings (meaning, not keywords)',
    'a vector DB and approximate nearest neighbor (ANN) search',
    'precision vs recall (and when you optimize which)',
    'candidate generation then ranking in a recommender',
    'online vs batch inference / model serving',
    'a feature store (same features offline for training and online for serving)',
    'an A/B test with a guardrail metric',
    'model drift and a retraining trigger',
    'reranking the top-K candidates with a heavier model',
  ] },
  { key: 'vern-observability', name: '可观测性/运维术语', terms: [
    'the three pillars — metrics, logs, and traces',
    'p50 / p95 / p99 percentiles (not the average)',
    'a distributed trace and a span across services',
    'alerting on SLO burn rate, not on raw thresholds',
    'a cardinality explosion in your metrics labels',
    'structured logging (queryable fields, not free text)',
    'the golden signals — latency, traffic, errors, saturation',
  ] },
]

// ---- LAYER 2: think-out-loud, new decks (distinct scenarios)
const THINK = [
  { key: 'think-estimate-aloud', name: '当场估算', n: 8,
    focus: `Estimating out loud — back-of-the-envelope. Formulas: "Let's say we have 100M users, ~1% active per second, so roughly 1M QPS." / "Let me state my assumptions first." / "Rounding to a nice number..." / "Let me sanity-check that against ..." Her weakness: she avoids numbers or fumbles them. Teach stating assumptions, doing the arithmetic aloud cleanly, and using the number to drive a design decision. Distractors: dodging the estimate, a number with no derivation, a nervous over-hedge.` },
  { key: 'think-handle-pushback', name: '面试官反对时', n: 8,
    focus: `The interviewer challenges your answer ("Wouldn't that bottleneck?", "Why not just X?"). Teach both moves: conceding gracefully when they're right ("Good point — you're right, let me reconsider. I'd instead ...") AND holding your ground with a reason ("I hear you, but I'd still lean X because ...; the risk with X is ..."). Her weakness: she either freezes or caves without reasoning. Distractors: caving with no reason, defensive/stubborn, rambling non-answer.` },
  { key: 'think-hit-a-wall', name: '卡住/不会时', n: 8,
    focus: `Hitting a wall gracefully. Saying "I don't know" without losing credibility: "I haven't used X directly, but from first principles I'd expect ..." / "Let me reason through it." / "Can I get a hint on ...?" / narrating uncertainty honestly. Her weakness: she freezes on "okay..." or bluffs. Distractors: freezing, bluffing a confident wrong answer, over-apologizing and giving up.` },
  { key: 'think-scope-requirements', name: '先厘清范围', n: 8,
    focus: `Gathering requirements out loud before designing: "Before I design, let me clarify a few things — what's the scale, and what matters most, latency or consistency?" / functional vs non-functional / narrowing scope explicitly ("I'll focus on the write path and treat auth as out of scope"). Her weakness: she dives in without scoping, or echoes the prompt. Distractors: diving straight in, asking nothing, asking a scattershot list with no priority.` },
]

// ---- LAYER 3: structuring an answer, new decks
const STRUCT = [
  { key: 'struct-behavioral-star', name: '行为题的 STAR 结构', n: 8,
    focus: `Behavioral answers spoken tightly in STAR: "tell me about a conflict / a failure / a time you led / a hard decision". Teach a spoken 4-beat: Situation (one line + stakes) → Task (your specific responsibility) → Action (what YOU did, "I" not "we") → Result (a number / outcome + what you learned). Her weakness: rambling, burying her own role in "we", no result. Ground lightly in her TikTok/Meta scope. Distractors: all-context-no-action, "we" with no personal ownership, no result/learning.` },
  { key: 'struct-why-decision', name: '为什么这么选', n: 8,
    focus: `Defending a decision: "why did you choose X?" / "walk me through your reasoning." Teach: name the alternatives, the deciding constraint, and the tradeoff you accepted — "I chose X over Y because our constraint was Z; that costs us W, which was acceptable because ...". Her weakness: "it just made sense" with no reasoning. Distractors: unjustified assertion, listing options without deciding, over-long lecture.` },
  { key: 'struct-followup-drilldown', name: '被追问细节时', n: 7,
    focus: `Handling the interviewer drilling one level deeper ("okay but how exactly does the failover work?", "what happens if that node dies mid-write?"). Teach going deeper on demand without losing the thread: "Sure, let me zoom in — ...", walking the exact mechanism step by step. Her weakness: repeating the high-level answer, or freezing on the detail. Distractors: restating the high level, hand-waving "it just handles it", freezing.` },
  { key: 'struct-close-summary', name: '收束与总结', n: 7,
    focus: `Closing/summarizing a design or coding answer: "To recap, the key tradeoffs were X and Y, and I'd lean X for this scale." / narrating a coding walkthrough ("Let me walk through my approach before I code — I'll use a hash map because ..."). Her weakness: trailing off without landing, no recap. Distractors: trailing off, re-explaining everything, an abrupt "yeah that's it".` },
]

const SCHEMA = { type: 'object', properties: {
  key: { type: 'string' }, written: { type: 'integer' }, findings: { type: 'integer' }, note: { type: 'string' },
}, required: ['key', 'written'] }

const COMMON = `WORKING DIRECTORY: ${ROOT}

HER PROFILE: mid-level backend engineer (TikTok ads platform / Meta), fluent English but spoken
technical delivery breaks under interview pressure — wrong term forms ("read pass" for "read path"),
stalls ("so so, in in"), losing the thread, echoing the question. These cards fix "understands it
but can't say it".

GROUND distractors in real failure modes; where useful, skim ${ROOT}/reports/tech-stumbles.json for
how she actually stumbles. Do not invent interviews.

FORMAT — copy the card shape EXACTLY from any file in ${ROOT}/src/content/interview-english/vern-*.json.
Fixed fields: "format":"mcq","atomType":"fit","topic":"interview-english","sub":"<KEY>". id "ien-<KEY>-001"…
zero-padded, unique. scenario 中文 ≤90字 (real interview context, answerable alone) + scenario_en. q 中文
("该怎么说出口") + q_en. options = 4 SPOKEN English lines, exactly one is how a strong engineer really
says it, 3 distractors = (a) wrong term-form/Chinglish, (b) rambling loop, (c) textbook-robotic;
options_en = same English strings. answer:[index] VARIED across cards; correct option must NOT be the
longest — keep all four comparable, strong spoken answers are tight. why 中文 ≤2句 naming the principle +
why_en one natural spoken sentence. tradeoff (地道 vs 卡壳 axis), whenOtherWins, tags ["spoken-tech",<KEY>,
domain]. optionMeanings/_en, optionScenarioImpacts/_en, optionDirectness/_en per rubric (1 sentence ≤70
chars each, don't restate why). termDefinitions: gloss every jargon term with meaningEn for TTS.

WRITE a JSON array to ${ROOT}/src/content/interview-english/<KEY>.json (only the array). VERIFY, loop ≤3:
  cd "${ROOT}" && node scripts/validate-deck.mjs "src/content/interview-english/<KEY>.json"
  cd "${ROOT}" && node scripts/audit-card-quality.mjs "src/content/interview-english/<KEY>.json" --limit=0
validate must pass, zero audit findings on your cards. Return {key:"<KEY>", written, findings, note}.`

function vernPrompt(a) {
  return `You write ${a.terms.length} SPOKEN-VERNACULAR drill cards for domain **${a.name}** — teaching
Ashlyn to SAY each assigned term the way engineers actually say it aloud.

YOUR ASSIGNED TERMS (write exactly one card per term — this list is yours alone, do not stray to
terms outside it, that prevents overlap with other decks):
${a.terms.map((t, i) => `  ${i + 1}. ${t}`).join('\n')}

For each: build a card around a real interview need — she wants to express the concept; which spoken
line is how an engineer really says it? Teach the exact term FORM plus one natural collocation that
proves she knows the mechanism, not just the word (e.g. consistent hashing → "we hash nodes and keys
onto a ring, so adding a node only reshuffles the keys next to it" — not "we spread keys evenly").

${COMMON.replace(/<KEY>/g, a.key)}`
}

function deckPrompt(d) {
  return `You write ${d.n} SPOKEN-DELIVERY drill cards. Deck: **${d.name}** (${d.key}).

FOCUS: ${d.focus}

${COMMON.replace(/<KEY>/g, d.key)}`
}

phase('Write')
const jobs = [
  ...VERN.map((a) => ({ prompt: vernPrompt(a), label: `V:${a.key}` })),
  ...THINK.map((d) => ({ prompt: deckPrompt(d), label: `T:${d.key}` })),
  ...STRUCT.map((d) => ({ prompt: deckPrompt(d), label: `S:${d.key}` })),
]
const results = await parallel(jobs.map((j) => () =>
  agent(j.prompt, { label: j.label, phase: 'Write', effort: 'high', schema: SCHEMA })))

const done = results.filter(Boolean)
const total = done.reduce((a, r) => a + (r.written || 0), 0)
log(`Wrote ${total} new cards across ${done.length} decks.`)

phase('Verify')
const verify = await agent(
  `Verify the expanded interview-english track. From ${ROOT}:
 1. DEDUP CHECK — no concept should repeat across decks. Run this and report any group with >1:
    node -e 'const fs=require("fs"),g=require("child_process").execSync("ls src/content/interview-english/*.json").toString().trim().split("\\n");const by={};for(const f of g){for(const c of JSON.parse(fs.readFileSync(f))){const k=c.options[c.answer[0]].toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,45);(by[k]=by[k]||[]).push(f.split("/").pop());}}for(const k in by){if(by[k].length>1)console.log(by[k].join(" | "));}'
    If any duplicates print, note them (do not fix — just report).
 2. node scripts/validate-deck.mjs   (must pass, all cards valid)
 3. npm run build:deck   (report the interview-english track count)
 4. node scripts/audit-card-quality.mjs src/content/interview-english/*.json --limit=0 2>&1 | grep -oE '^\\[S[0-9]\\] [a-z_.]+' | sort | uniq -c | sort -rn
 Report: dedup result, validate pass/fail, final interview-english count, and any audit findings.
 Do NOT edit card files.`,
  { label: 'dedup + build', phase: 'Verify', effort: 'low' },
)

return {
  decks_written: done.length,
  cards_written: total,
  per_deck: done.map((r) => ({ key: r.key, n: r.written, findings: r.findings })),
  verify_report: verify,
}
