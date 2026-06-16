/**
 * Pure-logic self-test, run with: npm run selftest  (tsx, no device needed)
 * Covers: deck validity, the M2a bundle, shuffle remap, grading rules, FSRS
 * roundtrip, queue building, tracks, planner, streak, rhythm→retention.
 */
import { Rating, State } from 'ts-fsrs';
import cardsJson from '../src/content/cards.json';
import bundleJson from '../src/content/deck.bundle.json';
import seedTracksJson from '../src/content/tracks.json';
import type { Card, Track } from '../src/types';
import { shuffleWithMap } from '../src/logic/shuffle';
import { chainCorrect, choiceCorrect, minIntervalDays, toFeedbackGrade, toFsrsRating } from '../src/logic/grading';
import { parseCloze } from '../src/logic/cloze';
import {
  applyReview,
  deserializeFsrs,
  emptyCard,
  getRequestRetention,
  serializeFsrs,
  setRequestRetention,
} from '../src/logic/srs';
import {
  buildQueue,
  buildWeakSweepQueue,
  dueAdditions,
  introducedTodayCount,
  isDueNow,
  laterTodayCount,
  orderSessionQueue,
  type SrsEntry,
} from '../src/logic/queue';
import { localDateStr } from '../src/logic/dates';
import { buildFeedbackExport } from '../src/logic/feedback';
import { ALL_TRACK, cardMatchesTrack, filterDeck, trackIdFromName } from '../src/logic/tracks';
import { ALL_CATEGORY, buildCategoryStats, categoryStatus, filterByCategory } from '../src/logic/categories';
import {
  filterSystemDesignRoadmapStage,
  legacyTrackToRoadmapStage,
  SYSTEM_DESIGN_ROADMAP,
} from '../src/logic/systemDesignRoadmap';
import { DEFAULT_SETTINGS, settingsFromKv, settingsToKv } from '../src/logic/settings';
import { deadlineFloorDays, isFinalStretch, planNewPerDay } from '../src/logic/planner';
import { computeStreak, dailyGoal } from '../src/logic/streak';
import {
  becameRemembered,
  dueByTomorrowCount,
  estimateMinutes,
  fastAnswerNote,
  isStreakMilestone,
  median,
  minutesFromMs,
  PLAN_CHUNK,
  planChunk,
  readingTimerMs,
  READING_TIMER_SEC,
  TIMER_FALLBACK_SEC,
  typicalTimesByType,
} from '../src/logic/gameFeel';
import { chooseConceptVisual, detectTerms } from '../src/logic/terms';
import { buildArchitectureVisual } from '../src/logic/architectureVisuals';
import { NEW_PER_DAY, RECOMMENDED_NEW_PER_DAY, RHYTHMS } from '../src/config';
import reciteBundleJson from '../src/content/recite.bundle.json';
import reciteThreadsJson from '../src/content/recite.threads.json';
import { buildThreads, threadOfItem, threadSiblings } from '../src/recite/threads';
import type { ReciteItem, ReciteThread } from '../src/recite/types';
import {
  EMPTY_FILTER,
  buildSections,
  countRows,
  countSections,
  dots,
  dupeIds,
  filterGroups,
  filterSections,
  fmtClock,
  groupByCompany,
  hasScriptVersions,
  isFillerQuestion,
  matchesFilter,
  queueChipLabel,
  resolveVersion,
  rowTags,
  splitCanon,
  toRow,
  versionOptions,
} from '../src/recite/library';

const cards = cardsJson as unknown as Card[];
const bundle = bundleJson as unknown as Card[];
const seedTracks = seedTracksJson as unknown as Track[];

let failures = 0;
function t(name: string, cond: boolean) {
  if (!cond) {
    failures++;
    console.error(`  ✗ ${name}`);
  } else {
    console.log(`  ✓ ${name}`);
  }
}

// ---- deck validity ----------------------------------------------------
console.log('deck');
t('34 cards ported', cards.length === 34);
t('unique ids', new Set(cards.map((c) => c.id)).size === cards.length);
t('all cards carry why + why_en', cards.every((c) => !!c.why && !!c.why_en));
t('no legacy field names remain', cards.every((c) => !('en' in c) && !('other' in c) && !('opts' in c)));
for (const c of cards) {
  if (c.format === 'mcq' || c.format === 'code') {
    t(`${c.id} single answer in range`, c.answer?.length === 1 && c.answer[0] < (c.options?.length ?? 0));
  }
  if (c.format === 'multi') t(`${c.id} multi answers`, (c.answer?.length ?? 0) >= 1);
  if (c.format === 'cloze') t(`${c.id} has blanks`, parseCloze(c.text ?? '').some((s) => s.type === 'blank'));
  if (c.format === 'chain') {
    const sorted = [...(c.answerOrder ?? [])].sort((a, b) => a - b);
    t(`${c.id} answerOrder is permutation`, sorted.every((v, i) => v === i) && sorted.length === c.steps?.length);
  }
}
t('diagram patch applied (db-017, db-024)', cards.filter((c) => c.diagram).map((c) => c.id).join(',') === 'db-017,db-024');

// ---- shuffle ----------------------------------------------------------
console.log('shuffle');
{
  const original = ['a', 'b', 'c', 'd', 'e'];
  const s = shuffleWithMap(original);
  t('is permutation', [...s.items].sort().join('') === 'abcde');
  t('map is consistent', s.items.every((item, k) => item === original[s.toOriginal[k]]));
  const single = shuffleWithMap(['x']);
  t('single item ok', single.items[0] === 'x' && single.toOriginal[0] === 0);
}

// ---- grading ----------------------------------------------------------
console.log('grading');
t('mcq correct', choiceCorrect([1], new Set([1])));
t('mcq wrong', !choiceCorrect([1], new Set([2])));
t('multi exact set', choiceCorrect([0, 1, 2], new Set([2, 0, 1])));
t('multi partial is wrong', !choiceCorrect([0, 1, 2], new Set([0, 1])));
t('multi superset is wrong', !choiceCorrect([0, 1], new Set([0, 1, 2])));
t('chain exact', chainCorrect([1, 0, 2, 3], undefined, [1, 0, 2, 3]));
t('chain alt order accepted', chainCorrect([1, 0, 2, 3], [[1, 0, 3, 2]], [1, 0, 3, 2]));
t('chain wrong', !chainCorrect([1, 0, 2, 3], [[1, 0, 3, 2]], [0, 1, 2, 3]));
t('forgot → Again', toFsrsRating('forgot', true, false) === Rating.Again);
t('fuzzy → Hard', toFsrsRating('fuzzy', true, false) === Rating.Hard);
t('got + correct → Good', toFsrsRating('got', true, false) === Rating.Good);
t('got + cloze(null) → Good', toFsrsRating('got', null, false) === Rating.Good);
// M3 §3.2 correctness-gated floor (min days before a card may reappear)
t('minInterval: wrong → 1 (may return tomorrow)', minIntervalDays('fuzzy', false, false) === 1);
t('minInterval: idk → 1', minIntervalDays('got', true, true) === 1);
t('minInterval: correct+fuzzy uses the floor', minIntervalDays('fuzzy', true, false, 4) === 4);
t('minInterval: correct+fuzzy scales with deadline floor', minIntervalDays('fuzzy', true, false, 9) === 9);
t('minInterval: correct+forgot (guessed) → 2', minIntervalDays('forgot', true, false) === 2);
t('minInterval: cloze forgot → 1', minIntervalDays('forgot', null, false) === 1);
t('minInterval: correct+got → 1 (FSRS decides)', minIntervalDays('got', true, false) === 1);
t('got + wrong → capped Hard', toFsrsRating('got', false, false) === Rating.Hard);
t('got + idk → capped Hard', toFsrsRating('got', null, true) === Rating.Hard);
t('feedback grade: forgot exports as unknown', toFeedbackGrade('forgot') === 'unknown');

// ---- term helper ------------------------------------------------------
console.log('terms');
{
  const termCard = {
    id: 'terms-001',
    format: 'mcq',
    atomType: 'fact',
    topic: 'networking',
    sub: 'transport',
    q: 'TCP、HTTP、UDP、WebRTC 分别适合什么场景？',
    why: 'w',
    why_en: 'w',
  } as Card;
  const detected = detectTerms(termCard);
  t('detects common networking acronyms', detected.map((x) => x.label).join(',') === 'TCP,HTTP,UDP,WebRTC');
  t('detected terms carry English copy', detected.every((x) => x.englishName.length > 0 && x.meaningEn.length > 0));
  t('network terms choose a concept visual', chooseConceptVisual(detected)?.id === 'tcp-udp');

  const apiCard = {
    ...termCard,
    q: 'API 网关的核心职责是什么？',
  };
  t('does not match IP inside API', detectTerms(apiCard).map((x) => x.label).join(',') === 'API');
  const cassandraCard = {
    ...termCard,
    q: 'Cassandra 为什么适合大规模水平扩展写入？',
  };
  t('Cassandra chooses masterless visual', chooseConceptVisual(detectTerms(cassandraCard))?.id === 'cassandra');

  // longest-match dedup: HTTP must not fire inside HTTP/2
  const http2Card = { ...termCard, q: 'gRPC 为什么要跑在 HTTP/2 上？' };
  const http2Labels = detectTerms(http2Card).map((x) => x.label);
  t('HTTP/2 wins over HTTP at the same position', http2Labels.includes('HTTP/2') && !http2Labels.includes('HTTP'));

  // visual routing follows first occurrence, not branch order
  const mixedCard = { ...termCard, q: 'TCP 和 UDP 的取舍，会影响 Cassandra 集群间通信吗？' };
  t('earliest term picks the visual (TCP before Cassandra)', chooseConceptVisual(detectTerms(mixedCard))?.id === 'tcp-udp');

  const webhookCard = { ...termCard, q: 'Stripe webhook 为什么要做幂等处理？' };
  t('detects webhook as an HTTP callback term', detectTerms(webhookCard).map((x) => x.label).includes('Webhook'));
}

// ---- automatic architecture visuals ----------------------------------
console.log('architecture visuals');
{
  const cacheCard = {
    id: 'arch-cache-001',
    format: 'mcq',
    atomType: 'fit',
    topic: 'system-design',
    sub: 'caching',
    scenario: 'A read-heavy feed service uses Redis cache in front of Postgres.',
    q: '为什么 cache-aside 适合这个服务？',
    options: ['缓存热点读', '每次都写主库', '所有请求进队列', '完全不要数据库'],
    answer: [0],
    why: 'Cache-aside 让服务先读缓存，miss 时再读数据库并写回缓存。',
    why_en: 'Cache-aside checks cache first, falls back to the database on miss, and fills the cache.',
  } as Card;
  const visual = buildArchitectureVisual(cacheCard);
  t('cache card gets auto architecture diagram', !!visual?.diagram.includes('Cache / Redis'));
  t('cache card gets cache-aside pseudocode', !!visual?.codeSample?.includes('cache.get'));

  const redisPubSubCard = {
    ...cacheCard,
    id: 'arch-redis-pubsub-001',
    sub: 'pubsub',
    scenario: 'Chat servers use Redis Pub/Sub to fan out messages to subscribed servers.',
    q: '为什么 Redis Pub/Sub 适合在线消息转发？',
    why: 'Redis 维护频道到订阅连接的映射，并沿现有连接推送消息。',
    why_en: 'Redis maintains channel-to-subscriber connection state and pushes over existing connections.',
  } as Card;
  const redisPubSubVisual = buildArchitectureVisual(redisPubSubCard);
  t('Redis Pub/Sub does not get cache-aside pseudocode', !redisPubSubVisual?.codeSample?.includes('cache.get'));

  const queueCard = {
    ...cacheCard,
    id: 'arch-queue-001',
    scenario: 'An API Gateway sends slow video transcoding work to a queue and workers update object storage.',
    q: '为什么不要在同步请求里做 transcoding？',
    why: 'Queue and workers decouple slow work from user-facing latency.',
    why_en: 'Queues and workers decouple slow work from user-facing latency.',
  } as Card;
  const queueVisual = buildArchitectureVisual(queueCard);
  t('queue card gets worker path', !!queueVisual?.diagram.includes('queue --> worker'));
  t('queue card gets idempotent worker pseudocode', !!queueVisual?.codeSample?.includes('processed(event.id)'));

  const modelingCard = {
    ...cacheCard,
    id: 'arch-modeling-001',
    sub: 'data-modeling',
    scenario: 'Data modeling for Postgres: normalize user and order tables to avoid duplicate user fields.',
    q: 'What tradeoff does normalized data modeling create?',
    why: 'Normalization reduces duplicate writes but can require joins on reads.',
    why_en: 'Normalization reduces duplicate writes but can require joins on reads.',
  } as Card;
  const modelingVisual = buildArchitectureVisual(modelingCard);
  t('data modeling does not imply Model Service', !modelingVisual?.diagram.includes('Model Service'));

  const relationalCard = {
    ...cacheCard,
    id: 'arch-relational-001',
    sub: 'data-modeling',
    scenario: 'Structured user, order, and product data needs transactions and complex SQL queries.',
    q: 'Which storage is the best fit?',
    options: ['S3 object storage', 'DynamoDB', 'Postgres relational database', 'MongoDB'],
    answer: [2],
    why: 'Postgres fits relational data with transactions, constraints, and SQL joins.',
    why_en: 'Postgres fits relational data with transactions, constraints, and SQL joins.',
    whenOtherWins: 'Use DynamoDB or S3 only when the data model changes to access-pattern queries or large blobs.',
  } as Card;
  const relationalVisual = buildArchitectureVisual(relationalCard);
  // A selection card whose scenario is a requirements list (no data flow) is a
  // COMPARISON — its visual is the §1.7 table, not an architecture sketch.
  t('selection card without data flow gets no auto diagram', relationalVisual === null);

  const noFlowNosqlCard = {
    ...cacheCard,
    id: 'arch-nosql-001',
    scenario: '数据结构频繁变化，且要跨多台服务器水平扩展，不依赖复杂事务。',
    q: '选哪类存储？',
    options: ['关系型数据库', 'NoSQL 文档库', '内存缓存', '对象存储'],
    answer: [1],
    why: 'schema 灵活 + 水平扩展指向 NoSQL。',
    why_en: 'Flexible schema plus horizontal scaling points to NoSQL.',
  } as Card;
  t('requirements-list NoSQL card gets no auto diagram', buildArchitectureVisual(noFlowNosqlCard) === null);

  const numberCard = {
    ...cacheCard,
    id: 'arch-number-001',
    atomType: 'number',
    scenario: 'Redis cache in front of Postgres serves hot reads.',
  } as Card;
  t('number card never gets an auto diagram', buildArchitectureVisual(numberCard) === null);
}

// ---- FSRS roundtrip ---------------------------------------------------
console.log('fsrs');
{
  const now = new Date('2026-07-01T09:00:00');
  let c = emptyCard(now);
  c = applyReview(c, now, Rating.Good);
  t('first Good schedules ahead', c.due.getTime() > now.getTime());
  t('state leaves New', c.state !== State.New);
  let again = emptyCard(now);
  again = applyReview(again, now, Rating.Again);
  t('Again leaves today review debt', localDateStr(again.due) > localDateStr(now) && !isDueNow(again, now));
  // M3 §3.2: a correct-but-fuzzy card is floored several days out, not tomorrow
  let cf = emptyCard(now);
  cf = applyReview(cf, now, toFsrsRating('fuzzy', true, false), minIntervalDays('fuzzy', true, false, 4));
  const cfDays = Math.round((cf.due.getTime() - now.getTime()) / 86400000);
  t('correct+fuzzy floored ≥4 days (not tomorrow)', cfDays >= 4);
  const revived = deserializeFsrs(serializeFsrs(c));
  t('roundtrip revives Date', revived.due instanceof Date && revived.due.getTime() === c.due.getTime());
  t('roundtrip keeps state/stability', revived.state === c.state && revived.stability === c.stability);
}

// ---- queue ------------------------------------------------------------
console.log('queue');
{
  const now = new Date('2026-07-01T09:00:00');
  const today = localDateStr(now);
  const mk = (over: Partial<ReturnType<typeof emptyCard>>, firstSeen: string): SrsEntry => ({
    fsrs: { ...emptyCard(now), ...over },
    firstSeen,
  });
  const srs = new Map<string, SrsEntry>([
    // review card due yesterday → in queue
    ['db-001', mk({ state: State.Review, due: new Date('2026-06-30T20:00:00') }, '2026-06-20')],
    // review card due later today (day-granular) → in queue
    ['db-002', mk({ state: State.Review, due: new Date('2026-07-01T22:00:00') }, '2026-06-20')],
    // learning card due in 5 min → in queue via learn-ahead
    ['db-003', mk({ state: State.Learning, due: new Date('2026-07-01T09:05:00') }, today)],
    // learning card due in 2 hours → NOT in queue, counts as later-today
    ['db-004', mk({ state: State.Learning, due: new Date('2026-07-01T11:00:00') }, today)],
    // review card due tomorrow → not due, not later-today
    ['db-005', mk({ state: State.Review, due: new Date('2026-07-02T09:00:00') }, '2026-06-20')],
  ]);
  t('isDueNow: overdue review', isDueNow(srs.get('db-001')!.fsrs, now));
  t('isDueNow: review due tonight counts today', isDueNow(srs.get('db-002')!.fsrs, now));
  t('isDueNow: learn-ahead window', isDueNow(srs.get('db-003')!.fsrs, now));
  t('isDueNow: learning beyond window excluded', !isDueNow(srs.get('db-004')!.fsrs, now));
  t('introducedToday counts firstSeen=today', introducedTodayCount(srs, now) === 2);
  const q = buildQueue(cards, srs, now, { newPerDay: 10 });
  const dueIds = q.filter((id) => srs.has(id));
  const freshIds = q.filter((id) => !srs.has(id));
  t('due set correct', [...dueIds].sort().join(',') === 'db-001,db-002,db-003');
  t('due sorted oldest-first', q[0] === 'db-001');
  t('new quota = 10 - 2 introduced', freshIds.length === 8);
  t('new cards are date-shuffled, not deck order', freshIds.length === 8 && freshIds[0] !== 'db-006');
  t('new card shuffle is stable within a day', buildQueue(cards, srs, now, { newPerDay: 10 }).join(',') === q.join(','));
  t('reviews precede new cards', dueIds.every((id) => q.indexOf(id) < q.indexOf(freshIds[0])));
  t('laterToday counts the 11:00 learning card', laterTodayCount(cards, srs, now) === 1);
  const reviewedToday = new Set(['db-002', 'db-004', 'db-006']);
  const qReviewed = buildQueue(cards, srs, now, { newPerDay: 10, reviewedToday });
  t('reviewed today excludes due cards', !qReviewed.includes('db-002'));
  t('reviewed today excludes fresh cards', !qReviewed.includes('db-006'));
  t('laterToday skips reviewed-today cards', laterTodayCount(cards, srs, now, undefined, reviewedToday) === 0);
  const qZero = buildQueue(cards, srs, now, { newPerDay: 2 });
  t('quota exhausted → no new cards', qZero.filter((id) => !srs.has(id)).length === 0);

  // orderSessionQueue: dues keep buildQueue order, only the new tail shuffles
  const ordered = orderSessionQueue(q, srs, () => 0.42);
  t('session order: dues stay ahead of news', ordered.slice(0, dueIds.length).every((id) => srs.has(id)));
  t('session order: due order preserved oldest-first', ordered.slice(0, dueIds.length).join(',') === dueIds.join(','));
  t('session order: same id set', [...ordered].sort().join(',') === [...q].sort().join(','));
  t('session order: review-only list passes through', orderSessionQueue(dueIds, srs, () => 0.42).join(',') === dueIds.join(','));

  // dueAdditions: the mid-session requeue sweep, bounded by scope
  const allIds = new Set(cards.map((c) => c.id));
  const none = new Set<string>();
  t('sweep finds all due cards deck-wide', dueAdditions(srs, allIds, none, now).sort().join(',') === 'db-001,db-002,db-003');
  t('sweep respects exclude (already queued)', dueAdditions(srs, allIds, new Set(['db-001', 'db-003']), now).join(',') === 'db-002');
  t('sweep skips every id already in the session queue', dueAdditions(srs, allIds, new Set(['db-001', 'db-002', 'db-003']), now).length === 0);
  t('sweep bounded to a new-only session scope', dueAdditions(srs, new Set(['db-006', 'db-007']), none, now).length === 0);
  t('sweep sees a lapsed card inside its scope', dueAdditions(srs, new Set(['db-003', 'db-006']), none, now).join(',') === 'db-003');
}

// ---- feedback export ---------------------------------------------------
console.log('feedback');
{
  const fb = new Map([
    ['db-001', { cardId: 'db-001', grade: 'got' as const, flags: [], term: '', note: '', updatedAt: '' }],
    ['db-002', { cardId: 'db-002', grade: 'unknown' as const, flags: [], term: '', note: '', updatedAt: '' }],
    ['db-003', { cardId: 'db-003', grade: 'got' as const, flags: ['term' as const], term: 'wide-column', note: '', updatedAt: '' }],
  ]);
  const items = buildFeedbackExport(cards, fb);
  t('exports weak + flagged only', items.map((i) => i.id).join(',') === 'db-002,db-003');
  t('export item shape matches design §13', 'sub' in items[0] && 'atomType' in items[0] && 'q' in items[0]);
}

// ---- M2a: bundle -------------------------------------------------------
console.log('bundle');
{
  const FORMATS = new Set(['mcq', 'multi', 'cloze', 'chain', 'code']);
  t('bundle is bigger than the seed deck', bundle.length > cards.length);
  t('bundle ids unique', new Set(bundle.map((c) => c.id)).size === bundle.length);
  t('bundle formats all known', bundle.every((c) => FORMATS.has(c.format)));
  t('bundle: every card tagged', bundle.every((c) => Array.isArray(c.tags) && c.tags.length > 0));
  t('bundle: every card has a track tag', bundle.every((c) => c.tags!.some((x) => x.startsWith('track:'))));
  t('bundle: every card has track metadata', bundle.every((c) => typeof c.track === 'string' && c.track.length > 0));
  t('bundle: every card has category metadata', bundle.every((c) => typeof c.category === 'string' && c.category.length > 0));
  t('bundle: why/why_en everywhere', bundle.every((c) => !!c.why && !!c.why_en));
  t('bundle: no legacy fields', bundle.every((c) => !('en' in c) && !('other' in c) && !('opts' in c)));
  const tables = bundle.filter((c) => c.table);
  t('bundle: ag/cr structured tables present', tables.length >= 5);
  t(
    'bundle: tables well-formed',
    tables.every(
      (c) =>
        Array.isArray(c.table!.headers) &&
        c.table!.headers.length > 0 &&
        c.table!.rows.every((r) => r.length === c.table!.headers.length),
    ),
  );
  t('bundle: ag cards present', bundle.some((c) => c.id.startsWith('ag-')));
  t('bundle: cr cards present', bundle.some((c) => c.id.startsWith('cr-')));
  const coreAgentIds = new Set([
    'ag-002',
    'ag-003',
    'ag-004',
    'llm-recap-ford-2026-07-31-004',
    'llm-recap-ford-2026-07-31-005',
  ]);
  const coreAgentCards = bundle.filter((c) => coreAgentIds.has(c.id));
  t(
    'bundle: core agent cards share one AI-coding module',
    coreAgentCards.length === coreAgentIds.size &&
      coreAgentCards.every(
        (c) =>
          c.category === 'Agent 核心 · Loop / When / Patterns / vs Call' &&
          c.tags?.includes('track:ai-coding'),
      ),
  );
}

// ---- M2a: tracks ---------------------------------------------------------
console.log('tracks');
{
  const mk = (id: string, tags: string[]): Card =>
    ({ id, format: 'mcq', atomType: 'fact', topic: 't', sub: 's', q: 'q', why: 'w', why_en: 'w', tags }) as Card;
  const a = mk('a', ['track:ai-coding', 'agents']);
  const b = mk('b', ['track:classic-sd', 'caching']);
  const c = mk('c', ['track:classic-sd', 'track:llm-sd']);
  const d = mk('d', ['track:low-level-design', 'oop']);
  const aiTrack: Track = { id: 'ai', name: 'AI', include: ['track:ai-coding'] };
  const llmTrack: Track = { id: 'llm', name: 'LLM', include: ['track:llm-sd'] };
  const lldTrack: Track = { id: 'lld', name: 'LLD', include: ['track:low-level-design'] };
  const noCache: Track = { id: 'nc', name: 'NC', include: ['track:classic-sd'], exclude: ['caching'] };
  t('include matches ANY tag', cardMatchesTrack(a, aiTrack) && !cardMatchesTrack(b, aiTrack));
  t('multi-track card matches both', cardMatchesTrack(c, llmTrack) && cardMatchesTrack(c, { id: 'x', name: '', include: ['track:classic-sd'] }));
  t('exclude wins over include', !cardMatchesTrack(b, noCache) && cardMatchesTrack(c, noCache));
  t('low-level track matches lld cards', cardMatchesTrack(d, lldTrack) && !cardMatchesTrack(a, lldTrack));
  t('ALL_TRACK matches everything', filterDeck([a, b, c, d], ALL_TRACK).length === 4);
  t('filterDeck unions correctly', filterDeck([a, b, c], llmTrack).map((x) => x.id).join(',') === 'c');
  const seedById = (id: string) => seedTracks.find((track) => track.id === id)!;
  t(
    'classic system design remains one top-level track',
    seedTracks.length === 8 && Boolean(seedById('classic-sd')) && !seedTracks.some((track) => track.id.startsWith('sd-path-')),
  );
  t('bundle covers ai-coding seed track', filterDeck(bundle, seedById('ai-coding')).length >= 11);
  t('bundle covers classic-sd seed track', filterDeck(bundle, seedById('classic-sd')).length >= 600);
  t('bundle covers llm-sd seed track', filterDeck(bundle, seedById('llm-sd')).length >= 300);
  t('bundle covers low-level-design seed track', filterDeck(bundle, seedById('low-level-design')).length >= 700);
  t('bundle covers interview-review seed track', filterDeck(bundle, seedById('interview-review')).length >= 250);
  // 编码基本功 = cli + 4 lbld-* content dirs (merged 2026-08-21)
  t('bundle covers coding-fundamentals seed track', filterDeck(bundle, seedById('coding-fundamentals')).length >= 260);
  t('trackIdFromName slugs + dedups', trackIdFromName('My Track', []) === 'my-track' && trackIdFromName('My Track', [{ id: 'my-track', name: '', include: [] }]) === 'my-track-2');
  const classicDeck = filterDeck(bundle, seedById('classic-sd'));
  const expectedRoadmapSizes: Record<string, number> = {
    'sd-00-framework': 45,
    'sd-01-patterns': 60,
    'sd-02-components': 70,
    'sd-03-cases': 93,
    'sd-04-upgrades': 60,
    'sd-10-foundations': 713,
    'sd-11-patterns-full': 338,
    'sd-12-data-storage': 1488,
    'sd-13-platform-network': 576,
    'sd-14-product-systems': 1218,
    'sd-15-reference': 979,
    'sd-99-gap-fill': 1811,
  };
  for (const [id, expected] of Object.entries(expectedRoadmapSizes)) {
    t(`${id} is an in-track classic-system-design stage`, filterSystemDesignRoadmapStage(classicDeck, id).length === expected);
  }
  const guidedClassicIds = new Set(
    SYSTEM_DESIGN_ROADMAP.flatMap((stage) => filterSystemDesignRoadmapStage(classicDeck, stage.id).map((card) => card.id)),
  );
  t('in-track system-design roadmap covers every classic-deck card', guidedClassicIds.size === classicDeck.length);
  t(
    'roadmap tags never leak outside classic system design',
    bundle
      .filter((card) => !card.tags?.includes('track:classic-sd'))
      .every((card) => !card.tags?.some((tag) => tag.startsWith('curriculum:sd-'))),
  );
  t(
    'legacy route selection maps into the classic-SD roadmap',
    legacyTrackToRoadmapStage('sd-path-12-data-storage') === 'sd-12-data-storage' &&
      legacyTrackToRoadmapStage('classic-sd') === null,
  );
  const persistedRoadmap = settingsToKv({ ...DEFAULT_SETTINGS, activeRoadmapStage: 'sd-14-product-systems' });
  t(
    'roadmap stage persists in settings',
    settingsFromKv(persistedRoadmap).activeRoadmapStage === 'sd-14-product-systems',
  );
  const categories = buildCategoryStats(classicDeck, new Map());
  t('classic track has category groups', categories.length > 40 && categories.every((c) => c.total > 0));
  t('category filter scopes deck', filterByCategory(classicDeck, categories[0].id).length === categories[0].total);
  // 面试复盘 track: the original 8 named categories (one per failure mode, build-deck
  // CATEGORY_OVERRIDES) must survive. Since the 2026-08-04 merge the track also unions
  // interview-drill decks, so extra per-interview categories on top are expected.
  const reviewCats = new Set(filterDeck(bundle, seedById('interview-review')).map((c) => c.category));
  t(
    'interview-review track keeps its 8 named categories',
    reviewCats.size >= 8 &&
      ['开场与叙事', '反问与读空气', '红旗与表达习惯', 'BQ 故事库', '先骨架后细节', '系统设计复盘', '编码反射', '知识短板'].every(
        (name) => reviewCats.has(name),
      ),
  );
  // M3: per-topic coverage status (seen = answered ≥1×, distinct from mastered)
  t('empty srs → all topics not-started', categories.every((c) => c.seen === 0 && categoryStatus(c) === 'not-started'));
  t('categoryStatus: none seen', categoryStatus({ seen: 0, total: 5 }) === 'not-started');
  t('categoryStatus: partway', categoryStatus({ seen: 2, total: 5 }) === 'in-progress');
  t('categoryStatus: all seen → covered', categoryStatus({ seen: 5, total: 5 }) === 'covered');
  {
    const catNow = new Date('2026-07-01T09:00:00');
    const pickName = categories[0].name;
    const pickIds = classicDeck.filter((c) => (c.category ?? 'Uncategorized') === pickName).map((c) => c.id);
    const seenSrs = new Map<string, SrsEntry>(
      pickIds.map((id) => [id, { fsrs: emptyCard(catNow), firstSeen: localDateStr(catNow) }]),
    );
    const withSeen = buildCategoryStats(classicDeck, seenSrs);
    const pick = withSeen.find((c) => c.name === pickName)!;
    t('seen counts cards with an SRS row', pick.seen === pick.total && categoryStatus(pick) === 'covered');
    t('covered topic sinks to the end', categoryStatus(withSeen[withSeen.length - 1]) === 'covered');
  }
  t('all category keeps deck', filterByCategory(classicDeck, ALL_CATEGORY).length === classicDeck.length);
}

// ---- M2a: planner --------------------------------------------------------
console.log('planner');
{
  const now = new Date('2026-07-01T09:00:00');
  const noDate = planNewPerDay({ targetDate: null, deckSize: 320, mastered: 0, now });
  t('no date → fallback pace, no warning', noDate.newPerDay === NEW_PER_DAY && noDate.warning === null);
  // spec §3 worked example: 320 atoms, 42 days, K=0 → ceil(320/33.6) = 10
  const six = planNewPerDay({ targetDate: '2026-08-12', deckSize: 320, mastered: 0, now });
  t('worked example: 320 cards / 42 days → 10/day', six.newPerDay === 10 && six.daysLeft === 42);
  const aboveRecommended = planNewPerDay({ targetDate: '2026-07-08', deckSize: 626, mastered: 0, now });
  t(
    'over recommendation → uncapped + warning',
    aboveRecommended.newPerDay === aboveRecommended.raw &&
      aboveRecommended.newPerDay > RECOMMENDED_NEW_PER_DAY &&
      aboveRecommended.warning !== null,
  );
  const past = planNewPerDay({ targetDate: '2026-06-20', deckSize: 100, mastered: 0, now });
  t('past date → warning, review-only', past.warning !== null && past.newPerDay === 0 && past.daysLeft === 0);
  const today = planNewPerDay({ targetDate: '2026-07-01', deckSize: 100, mastered: 0, now });
  t('date is today → review-only + warning', today.warning !== null && today.newPerDay === 0 && today.daysLeft === 0);
  const done = planNewPerDay({ targetDate: '2026-08-12', deckSize: 100, mastered: 100, now });
  t('fully mastered → floor of 1', done.newPerDay === 1);

  // M3 §3.2 Phase 2: deadline-scaled correct-fuzzy floor
  t('floor at recommended pace = 4', deadlineFloorDays(RECOMMENDED_NEW_PER_DAY) === 4);
  t('floor scales up under pressure (clamp 14)', deadlineFloorDays(1000) === 14);
  t('floor scales down when relaxed (clamp 2)', deadlineFloorDays(10) === 2);
  // M3 §3.2 Phase 3: final-stretch detection
  t('final stretch: 2 days left → true', isFinalStretch(2) === true);
  t('final stretch: no date → false', isFinalStretch(null) === false);
  t('final stretch: far out → false', isFinalStretch(30) === false);
  t('final stretch: day 0 → false (planner review-only)', isFinalStretch(0) === false);
  // M3 §3.2 Phase 3: weak-set sweep — mastered excluded, weakest first
  const mkWeak = (stability: number): SrsEntry => ({
    fsrs: { ...emptyCard(now), state: State.Review, stability },
    firstSeen: localDateStr(now),
  });
  const weakSrs = new Map<string, SrsEntry>([
    ['mastered', mkWeak(30)],
    ['w-mid', mkWeak(5)],
    ['w-low', mkWeak(1)],
  ]);
  const weakCards = [{ id: 'mastered' }, { id: 'w-mid' }, { id: 'w-low' }] as unknown as Parameters<
    typeof buildWeakSweepQueue
  >[0];
  const sweep = buildWeakSweepQueue(weakCards, weakSrs);
  t('weak sweep excludes mastered', !sweep.includes('mastered'));
  t('weak sweep weakest-first', sweep.join(',') === 'w-low,w-mid');
}

// ---- M2a: streak + daily goal ---------------------------------------------
console.log('streak');
{
  const now = new Date('2026-07-01T09:00:00');
  const days = (...ds: string[]) => new Set(ds);
  t('streak counts back from today', computeStreak(days('2026-07-01', '2026-06-30', '2026-06-29'), now) === 3);
  t('today missing → anchored at yesterday', computeStreak(days('2026-06-30', '2026-06-29'), now) === 2);
  t('gap breaks the streak', computeStreak(days('2026-07-01', '2026-06-29'), now) === 1);
  t('no history → 0', computeStreak(days(), now) === 0);
  t('two-day-old last study → 0', computeStreak(days('2026-06-28'), now) === 0);
  const g = dailyGoal(7, 3, 5);
  t('goal = done + due + quota', g.done === 7 && g.target === 15);
  t('cleared day → done === target', dailyGoal(20, 0, 0).target === 20);
}

// ---- 游戏的劲儿（docs/DESIGN_game-feel_2026-10-11.md 第 1 批 + A1）------------
console.log('game-feel');
{
  t('median odd', median([5, 1, 3]) === 3);
  t('median even', median([4, 1, 3, 2]) === 2.5);
  t('median empty → null', median([]) === null);

  // A1：样本够（≥20）用她的中位数，不够兜底 15 秒；没有用时 / 不在牌组里的记录不算
  const typeOf = (id: string) => (id.startsWith('f') ? 'fact' : id.startsWith('c') ? 'contrast' : undefined) as
    | 'fact'
    | 'contrast'
    | undefined;
  const samples = [
    ...Array.from({ length: 21 }, (_, i) => ({ cardId: `f${i}`, elapsedMs: (i + 1) * 1000 })),
    ...Array.from({ length: 19 }, (_, i) => ({ cardId: `c${i}`, elapsedMs: 4000 })),
    { cardId: 'gone', elapsedMs: 999_000 },
    { cardId: 'f-null', elapsedMs: null },
  ];
  const typical = typicalTimesByType(samples, typeOf);
  t('A1: ≥20 samples → her median', typical.fact.fromHistory && typical.fact.ms === 11_000 && typical.fact.samples === 21);
  t('A1: <20 samples → 15 s fallback', !typical.contrast.fromHistory && typical.contrast.ms === TIMER_FALLBACK_SEC * 1000);
  t('A1: no samples → fallback', typical.number.ms === TIMER_FALLBACK_SEC * 1000 && typical.number.samples === 0);
  t('A1: reading timer is a flat 60 s regardless of card type (2026-10-12)', READING_TIMER_SEC === 60 && readingTimerMs() === 60_000 && typical.fact.ms !== 60_000);
  t('A1: faster than median → ⚡ note', fastAnswerNote(4_600, 11_000) === '⚡ 5 秒');
  t('A1: slower than median → nothing (不渲染慢)', fastAnswerNote(12_000, 11_000) === null);
  t('A1: no answer time → nothing', fastAnswerNote(null, 11_000) === null);

  // A5：一组最多 PLAN_CHUNK 张；估时 = 每张按卡型中位数相加，向上取整
  const long = Array.from({ length: 340 }, (_, i) => `x${i}`);
  t('A5: 340 queued → plan shows only 60', planChunk(long).length === PLAN_CHUNK && planChunk(long)[0] === 'x0');
  t('A5: short queue untouched', planChunk(['a', 'b']).length === 2);
  const est = new Map<string, Card>([
    ['f1', { id: 'f1', atomType: 'fact' } as Card],
    ['f2', { id: 'f2', atomType: 'fact' } as Card],
  ]);
  t('A5: estimate minutes from typical times', estimateMinutes(['f1', 'f2', 'missing'], est, typical) === 1);
  t('A5: empty plan → 0 minutes', estimateMinutes([], est, typical) === 0);

  // A3「从忘记变成记住」：评分前不在 Review、评完进 Review、评分 ≥ Good
  t('A3: Learning → Review + Good counts', becameRemembered(State.Learning, State.Review, Rating.Good));
  t('A3: Relearning → Review + Good counts', becameRemembered(State.Relearning, State.Review, Rating.Good));
  t('A3: Review → Review is not new learning', !becameRemembered(State.Review, State.Review, Rating.Good));
  t('A3: Hard never counts', !becameRemembered(State.Relearning, State.Review, Rating.Hard));
  t('A3: still Learning → no', !becameRemembered(State.New, State.Learning, Rating.Good));
  {
    // 用真的 FSRS 走一遍：新卡记得 → 进学习步；隔天再记得 → 进 Review，这一下算「记住了」
    const d0 = new Date('2026-10-11T10:00:00');
    const c0 = emptyCard(d0);
    const c1 = applyReview(c0, d0, Rating.Good);
    const c2 = applyReview(c1, c1.due, Rating.Good);
    t(
      'A3: real FSRS path New→…→Review is caught exactly once',
      [becameRemembered(c0.state, c1.state, Rating.Good), becameRemembered(c1.state, c2.state, Rating.Good)].filter(Boolean)
        .length === 1 && c2.state === State.Review,
    );
  }

  // A3「明天预计到期」：到明天结束前到期的复习卡（含今天还欠着的），不在范围里的不算
  {
    const now = new Date('2026-10-11T10:00:00');
    const at = (iso: string): SrsEntry => ({
      fsrs: { ...emptyCard(now), state: State.Review, due: new Date(iso) },
      firstSeen: '2026-10-01',
    });
    const srs = new Map<string, SrsEntry>([
      ['overdue', at('2026-10-09T08:00:00')],
      ['tomorrow-night', at('2026-10-12T23:30:00')],
      ['day-after', at('2026-10-13T08:00:00')],
      ['other-track', at('2026-10-12T08:00:00')],
    ]);
    t(
      'A3: due-by-tomorrow counts overdue + tomorrow, scoped',
      dueByTomorrowCount(new Set(['overdue', 'tomorrow-night', 'day-after']), srs, now) === 2,
    );
  }

  t('minutes: any work → at least 1', minutesFromMs(20_000) === 1);
  t('minutes: nothing → 0', minutesFromMs(0) === 0);
  t('minutes: rounds', minutesFromMs(14.6 * 60_000) === 15);
  t('streak milestones 7/30/100 only', isStreakMilestone(7) && isStreakMilestone(30) && isStreakMilestone(100) && !isStreakMilestone(8));

  // 音效开关：默认开，老安装没有这个 key 也是开，存 '0' 才是关
  t('sound default on', DEFAULT_SETTINGS.soundEnabled === true);
  t('sound: missing key → on', settingsFromKv(new Map()).soundEnabled === true);
  t('sound: off roundtrips', settingsFromKv(settingsToKv({ ...DEFAULT_SETTINGS, soundEnabled: false })).soundEnabled === false);
}

// ---- M2a: rhythm → FSRS retention -----------------------------------------
console.log('rhythm');
{
  t('default retention 0.9', getRequestRetention() === 0.9);
  const now = new Date('2026-07-01T09:00:00');
  let cIntensive = emptyCard(now);
  setRequestRetention(RHYTHMS.intensive.requestRetention);
  t('retention switched to 0.95', getRequestRetention() === 0.95);
  for (const g of [Rating.Good, Rating.Good, Rating.Good] as const)
    cIntensive = applyReview(cIntensive, cIntensive.due, g);
  let cRelaxed = emptyCard(now);
  setRequestRetention(RHYTHMS.relaxed.requestRetention);
  for (const g of [Rating.Good, Rating.Good, Rating.Good] as const)
    cRelaxed = applyReview(cRelaxed, cRelaxed.due, g);
  t(
    'lower retention → wider spacing (same card, same grades)',
    cRelaxed.due.getTime() > cIntensive.due.getTime(),
  );
  setRequestRetention(0.9);
  t('retention restored to default', getRequestRetention() === 0.9);
}

// ---- M4: 念稿库（bundle 契约 + 库的纯逻辑）---------------------------------
console.log('recite');
{
  const items = reciteBundleJson as unknown as ReciteItem[];
  t('bundle 非空', items.length > 0);
  t('id 唯一', new Set(items.map((i) => i.id)).size === items.length);
  t(
    '每条都有 §3.1 的必填字段',
    items.every(
      (i) =>
        typeof i.id === 'string' &&
        typeof i.co === 'string' &&
        typeof i.target_sec === 'number' &&
        Array.isArray(i.points) &&
        Array.isArray(i.scored_idx) &&
        Array.isArray(i.canon_spans) &&
        Array.isArray(i.dialog_followups),
    ),
  );
  t('scored_idx ≤ 4（Cowan ~4 的工作记忆约束）', items.every((i) => i.scored_idx.length <= 4));
  t(
    'scored_idx / extra_idx 都指得到 points',
    items.every((i) => [...i.scored_idx, ...i.extra_idx].every((k) => i.points[k] != null)),
  );
  t('script 是 string 或 null，不是空串', items.every((i) => i.script === null || i.script.length > 0));
  t('有 dialog 的条目都带 turns', items.every((i) => !i.dialog || i.dialog.turns.length > 0));

  // 库的单位是 thread。threads.json 现在还是空的，所以这里拿到的是「一条一段」的派生结果。
  const rawThreads = reciteThreadsJson as unknown as ReciteThread[];
  const threads = buildThreads(items, rawThreads);
  const rows = threads.map(toRow);
  t('每条都落进恰好一条 thread', (() => {
    const seen = new Map<string, number>();
    for (const th of threads) for (const i of th.items) seen.set(i.id, (seen.get(i.id) ?? 0) + 1);
    return seen.size === items.length && [...seen.values()].every((n) => n === 1);
  })());
  t('没分组时一条一段', rawThreads.length > 0 || threads.length === items.length);
  t('thread 顺序跟着主问题在 bundle 里的位置', (() => {
    const pos = new Map(items.map((i, k) => [i.id, k]));
    return threads.every((th, k) => k === 0 || (pos.get(threads[k - 1].main.item.id) ?? 0) <= (pos.get(th.main.item.id) ?? 0));
  })());
  const groups = groupByCompany(rows);
  t('分组不丢链', countRows(groups) === threads.length);
  t(
    '公司按条数降序、同数按名字',
    groups.every((g, k) => k === 0 || groups[k - 1].n > g.n || (groups[k - 1].n === g.n && groups[k - 1].name < g.name)),
  );
  t(
    '场次按名字排序',
    groups.every((g) => g.sessions.every((s, k) => k === 0 || g.sessions[k - 1].name.localeCompare(s.name) <= 0)),
  );

  const first = groups[0];
  t('公司过滤只留那一家', filterGroups(groups, { ...EMPTY_FILTER, company: first.name }).length === 1);
  t(
    '只看有原声',
    filterGroups(groups, { ...EMPTY_FILTER, origOnly: true }).every((g) =>
      g.sessions.every((s) => s.rows.every((r) => r.thread.hasOrig)),
    ),
  );
  const sample = rows[0];
  t(
    '搜 item id 一定命中自己',
    matchesFilter(sample, { ...EMPTY_FILTER, query: sample.thread.main.item.id.toUpperCase() }),
  );
  t('搜不存在的词命中 0 条', countRows(filterGroups(groups, { ...EMPTY_FILTER, query: 'zzz-不存在-zzz' })) === 0);

  // 撞车 = 同一个 link_group 下 >1 条；单独一条不算。
  const dupes = dupeIds(items);
  const byGroup = new Map<string, number>();
  for (const i of items) if (i.link_group) byGroup.set(i.link_group, (byGroup.get(i.link_group) ?? 0) + 1);
  t(
    '撞车集合 = link_group 计数 >1 的那些',
    items.every((i) => dupes.has(i.id) === Boolean(i.link_group && (byGroup.get(i.link_group) ?? 0) > 1)),
  );

  // canon 高亮：切片拼回去必须一字不差，跨度必须被标成 canon。
  const withCanon = items.find((i) => i.script && i.canon_spans.length);
  if (withCanon?.script) {
    const segs = splitCanon(withCanon.script, withCanon.canon_spans);
    t('canon 切片拼回原文', segs.map((s) => s.text).join('') === withCanon.script);
    t('canon 跨度被标出来', segs.some((s) => s.canon));
  }
  t('没有 canon 时整段是一片', splitCanon('abc', []).length === 1);
  t('找不到的跨度被忽略', splitCanon('abc', ['zzz']).every((s) => !s.canon));

  t('点阵 5 满 / 0 空', dots(5) === '●●●●●' && dots(0) === '○○○○○' && dots(3.4) === '●●●○○');
  t('时钟 mm:ss', fmtClock(0) === '0:00' && fmtClock(65) === '1:05' && fmtClock(-3) === '0:00');

  // 行标签：云上 needs_rewrite 也要挂「稿要改」，而且不能和 bundle 的 rough 叠成两个。
  {
    const clean = rows.find((r) => r.thread.items.every((i) => i.quality !== 'rough' && !i.deferred))!;
    const base = { queueIds: new Set<string>(), dupes: new Set<string>(), nTakes: 0, lastTotal: null };
    const off = rowTags(clean, base).filter((x) => x.text === '稿要改');
    const on = rowTags(clean, { ...base, needsRewrite: true }).filter((x) => x.text === '稿要改');
    t('needs_rewrite 才挂稿要改', off.length === 0 && on.length === 1);
    const rough = rows.find((r) => r.thread.items.some((i) => i.quality === 'rough' || i.deferred));
    if (rough) {
      const both = rowTags(rough, { ...base, needsRewrite: true }).filter((x) => x.text === '稿要改');
      t('rough + needs_rewrite 不叠成两个标签', both.length === 1);
    }
    const withTakes = rowTags(clean, { ...base, nTakes: 3, lastTotal: 4.25 });
    t('录过 n 次带上次分数', withTakes.some((x) => x.text === '录过 3 次 · 上次 4.3'));
  }

  // ── 三段顺序（2026-09-03 她定的）：有原声 → BQ playbook → 其他 ──────────────
  {
    const secs = buildSections(rows);
    t('三段，顺序固定', secs.map((x) => x.id).join(',') === 'orig,playbook,other');
    t('三段不丢链', countSections(secs) === threads.length);
    const ids = new Set<string>();
    for (const sec of secs) {
      for (const co of sec.companies) for (const ses of co.sessions) for (const r of ses.rows) ids.add(r.thread.thread.thread_id);
    }
    t('每条链只落一段', ids.size === threads.length);

    const orig = secs[0];
    // 收全段的 item id：有原声的条目可能是链上的追问，不一定是主问题。
    const inOrig = new Set<string>();
    for (const co of orig.companies)
      for (const ses of co.sessions)
        for (const r of ses.rows) for (const i of r.thread.items) inOrig.add(i.id);
    t('有原声的一条不落', items.every((i) => !i.has_orig || inOrig.has(i.id)));
    // 同一场里只要有一条有原声，整场都在第一段 —— 不能把一场题拆到两个区。
    const origSessions = new Set(
      items.filter((i) => i.has_orig).map((i) => `${i.co || '其他'}//${i.interview || '（未分场）'}`),
    );
    t(
      '整场跟着走',
      items.every(
        (i) => !origSessions.has(`${i.co || '其他'}//${i.interview || '（未分场）'}`) || inOrig.has(i.id),
      ),
    );
    t('第一段公司按条数降序', orig.companies.every((c, k) => k === 0 || orig.companies[k - 1].n >= c.n));

    const pb = secs[1];
    const inPb: string[] = [];
    for (const co of pb.companies) for (const ses of co.sessions) for (const r of ses.rows) inPb.push(r.thread.main.item.id);
    t('playbook 段只有 playbook', inPb.every((id) => items.find((i) => i.id === id)?.source === 'playbook'));
    t('playbook 按公司平铺', pb.companies.every((c) => c.flat === true && c.sessions.length === 1));
    t(
      'playbook 公司按名字排',
      pb.companies.every((c, k) => k === 0 || pb.companies[k - 1].name.localeCompare(c.name) <= 0),
    );
    t('其他段默认折叠', secs[2].defaultCollapsed && !secs[0].defaultCollapsed && !secs[1].defaultCollapsed);

    // 过滤跨三段生效，命中数是加总。
    const f = { ...EMPTY_FILTER, origOnly: true };
    const filtered = filterSections(secs, f);
    t('只看有原声后只剩第一段', filtered.every((x) => x.id === 'orig'));
    t('命中数 = 有原声的链数', countSections(filtered) === threads.filter((th) => th.hasOrig).length);
  }

  // playbook 不再默认挂「稿要改」（2026-09-03 起 bundle 里是 ok/false）。
  {
    const base = { queueIds: new Set<string>(), dupes: new Set<string>(), nTakes: 0, lastTotal: null };
    const pbRows = rows.filter((r) => r.thread.main.item.source === 'playbook');
    t(
      'playbook 默认不挂稿要改',
      pbRows.length > 0 && pbRows.every((r) => !rowTags(r, base).some((x) => x.text === '稿要改')),
    );
  }

  // ── 英文题面是废话时把中文提到第一行 ──────────────────────────────────────
  {
    t('Okay. 算废话', isFillerQuestion('Okay.') && isFillerQuestion('Okay, sounds good.'));
    t('少于四个词算废话', isFillerQuestion('Tell me more'));
    t('正常题面不算', !isFillerQuestion('Tell me about a time you disagreed with your manager.'));
    t('空题面算废话', isFillerQuestion('   '));
    const asRow = (q: string, zh: string) =>
      toRow(buildThreads([{ ...items[0], question: q, question_zh: zh }], [])[0]);
    const r = asRow('Okay.', '第一题：滑动窗口');
    t('废话题面用中文当标题', r.title === '第一题：滑动窗口' && r.subtitle === 'Okay.');
    t('废话题面英文中文都还能搜到', r.search.includes('okay.') && r.search.includes('滑动窗口'));
    const normal = asRow('Walk me through the sliding window solution.', '中文');
    t('正常题面不动', normal.title === 'Walk me through the sliding window solution.' && normal.subtitle === '中文');
  }

  // ── 稿子版本：短版 / 长版 / 原稿 ─────────────────────────────────────────
  {
    const plain = { ...items[0], script: 'BASE', script_zh_gloss: 'G', target_sec: 60,
      script_long: null, gloss_long: '', target_sec_long: null,
      script_short: null, gloss_short: '', target_sec_short: null };
    t('没有长短版就不给开关', !hasScriptVersions(plain) && versionOptions(plain).length === 0);
    const r0 = resolveVersion(plain, 'long');
    t('没版本时一律落回原稿', r0.version === 'base' && r0.script === 'BASE' && r0.targetSec === 60);

    const both = { ...plain, script_long: 'LONG', gloss_long: 'GL', target_sec_long: 240,
      script_short: 'SHORT', gloss_short: 'GS', target_sec_short: 90 };
    t('长短齐全 = 两段开关', versionOptions(both).map((v) => v.id).join(',') === 'short,long');
    const rs = resolveVersion(both, 'short');
    t('短版取 short 三件套', rs.script === 'SHORT' && rs.gloss === 'GS' && rs.targetSec === 90);
    const rl = resolveVersion(both, 'long');
    t('长版取 long 三件套', rl.script === 'LONG' && rl.gloss === 'GL' && rl.targetSec === 240);

    // 真 bundle：28 条 playbook 带长短版，两版必须成对出现。
    const withLong = items.filter((i) => i.script_long);
    t('bundle 里长短版成对', withLong.length > 0 && withLong.every((i) => Boolean(i.script_short)));
    t('带版本的只有 playbook', withLong.every((i) => i.source === 'playbook'));
    t(
      '六个版本字段都在',
      items.every(
        (i) =>
          'script_long' in i && 'gloss_long' in i && 'target_sec_long' in i &&
          'script_short' in i && 'gloss_short' in i && 'target_sec_short' in i,
      ),
    );
    t('长版目标秒数比短版大', withLong.every((i) => (i.target_sec_long ?? 0) > (i.target_sec_short ?? 0)));
    t(
      '真条目给两段开关',
      withLong.every((i) => versionOptions(i).map((v) => v.id).join(',') === 'short,long'),
    );
    t('没版本的条目一段都不给', items.filter((i) => !i.script_long && !i.script_short)
      .every((i) => versionOptions(i).length === 0));

    const longOnly = { ...plain, script_long: 'LONG', gloss_long: '', target_sec_long: 240 };
    t('没有 short 时多一段原稿', versionOptions(longOnly).map((v) => v.id).join(',') === 'short,long,base');
    const rso = resolveVersion(longOnly, 'short');
    t('short 缺失就回落到基稿和基秒数', rso.script === 'BASE' && rso.gloss === 'G' && rso.targetSec === 60);
    t('gloss_long 为空回落到基 gloss', resolveVersion(longOnly, 'long').gloss === 'G');
    t('base 段就是基稿', resolveVersion(longOnly, 'base').script === 'BASE');
    t('选了不存在的版本回落到第一段', resolveVersion(both, 'base').version === 'short');
  }

  // ── 真 threads.json 的不变量 ──────────────────────────────────────────────
  {
    t('分组表非空', rawThreads.length > 0);
    t('thread_id 唯一', new Set(rawThreads.map((x) => x.thread_id)).size === rawThreads.length);
    t('每条链恰好一个主问题', rawThreads.every((x) => x.segments.filter((g) => g.role === 'main').length === 1));
    t('主问题排在第一段', rawThreads.every((x) => x.segments[0]?.role === 'main'));
    t('第一段不许 merge_into_prev', rawThreads.every((x) => !x.segments[0]?.merge_into_prev));
    t('每条链都写了「他为什么一直追问」', rawThreads.every((x) => (x.chain_note_zh || '').trim().length > 0));
    const byId = new Map(items.map((i) => [i.id, i]));
    t('分组表引用的条目都在 bundle 里', rawThreads.every((x) => x.segments.every((g) => byId.has(g.item_id))));
    t(
      '同一条链只来自同一场',
      rawThreads.every((x) => x.segments.every((g) => (byId.get(g.item_id)?.interview || '') === x.interview)),
    );
    const used = rawThreads.flatMap((x) => x.segments.map((g) => g.item_id));
    t('一个条目不会同时属于两条链', new Set(used).size === used.length);
    // 她点名的那一场：分组必须正好是这四组。
    const amazonReal = threads
      .filter((th) => th.interview === 'amazon interview' && th.grouped)
      .map((th) => th.items.map((i) => i.id.slice('iv:amazon-interview:'.length)));
    t(
      '真数据里 Amazon 那场 = [a01][a02..a05][a06,a07,a09,a10,a11,a12][a13,a15]',
      JSON.stringify(amazonReal) ===
        JSON.stringify([['a01'], ['a02', 'a03', 'a04', 'a05'], ['a06', 'a07', 'a09', 'a10', 'a11', 'a12'], ['a13', 'a15']]),
    );
    t(
      'bundle 的 thread_id 戳和分组表对得上',
      rawThreads.every((x) => x.segments.every((g) => byId.get(g.item_id)?.thread_id === x.thread_id)),
    );
  }

  // ── 对话流：真实面试的题整页就是原始对话（2026-09-03 她的要求）──────────────
  {
    const dm = threads.filter((th) => th.dialogMode);
    const notDm = threads.filter((th) => !th.dialogMode);
    t(
      'dialogMode 只认 interview / reference',
      dm.every((th) => th.main.item.source === 'interview' || th.main.item.source === 'reference') &&
        notDm.every((th) => th.main.item.source === 'playbook' || th.main.item.source === 'opener'),
    );
    t('分组过的链都是对话流', threads.filter((th) => th.grouped).every((th) => th.dialogMode));
    t('playbook 不进对话流', threads.filter((th) => th.main.item.source === 'playbook').every((th) => !th.dialogMode));
    // 整页就是逐句原文，所以每一段都必须真的有 turns，否则页面是空的。
    t(
      '对话流每一段都有逐句原文',
      dm.every((th) => th.items.every((i) => (i.dialog?.turns.length ?? 0) > 0)),
    );
    t(
      '每一句都有说话人和时间戳',
      dm.every((th) =>
        th.items.every((i) =>
          (i.dialog?.turns ?? []).every((x) => (x.sp === 'me' || x.sp === 'iv') && typeof x.s === 'number'),
        ),
      ),
    );
    // 「无念稿」对真实面试的题不再是缺陷标签。
    const base = { queueIds: new Set<string>(), dupes: new Set<string>(), nTakes: 0, lastTotal: null };
    t(
      '对话流不挂「无念稿」',
      rows
        .filter((r) => r.thread.dialogMode)
        .every((r) => !rowTags(r, base).some((x) => x.text.startsWith('无念稿'))),
    );
    const noScriptPlaybook = rows.find((r) => !r.thread.dialogMode && !r.hasScript);
    if (noScriptPlaybook) {
      t(
        '非对话流没稿时仍然挂「无念稿」',
        rowTags(noScriptPlaybook, base).some((x) => x.text.startsWith('无念稿')),
      );
    }
  }

  // ── 题 + 追问链：合成一组当单元测试（不依赖真数据长什么样）────────────────
  {
    const P = 'iv:amazon-interview:';
    const groups = [
      ['a01'],
      ['a02', 'a03', 'a04', 'a05'],
      ['a06', 'a07', 'a09', 'a10', 'a11', 'a12'],
      ['a13', 'a15'],
    ];
    const sample: ReciteThread[] = groups.map((g, k) => ({
      thread_id: `th:amazon-interview:${String(k + 1).padStart(2, '0')}`,
      interview: 'amazon interview',
      kind: k === 0 ? 'self-intro' : k === 3 ? 'coding' : 'bq',
      title: `Q${k + 1}`,
      title_zh: `第 ${k + 1} 问`,
      segments: g.map((sfx, j) => ({
        item_id: P + sfx,
        role: j === 0 ? ('main' as const) : ('followup' as const),
        label: j === 0 ? '主问题' : `追问 ${j}`,
        // 最后一组的追问故意标成「很短」，验证并段
        ...(k === 3 && j > 0 ? { merge_into_prev: true } : {}),
      })),
      chain_note_zh: '他一直在问，因为产品是什么没讲清楚。',
    }));
    const grouped = buildThreads(items, sample);
    const amazon = grouped.filter((th) => th.interview === 'amazon interview');
    t('Amazon 那场分成 4 条链', amazon.length === 4);
    t(
      'Amazon 分组 = [a01][a02..a05][a06,a07,a09,a10,a11,a12][a13,a15]',
      JSON.stringify(amazon.map((th) => th.items.map((i) => i.id.slice(P.length)))) ===
        JSON.stringify(groups),
    );
    t('主问题就是每组第一条', amazon.every((th, k) => th.main.item.id === P + groups[k][0]));
    t(
      '追问数 = 段数 - 1',
      amazon.every((th, k) => th.followupCount === groups[k].length - 1),
    );
    t(
      '目标秒数是全链之和',
      amazon.every((th) => th.targetSec === th.items.reduce((n, i) => n + i.target_sec, 0)),
    );
    t('分组过的 thread 标了 grouped', amazon.every((th) => th.grouped));
    t('merge_into_prev 只影响第一段之后的段', amazon[3].segments.map((x) => x.merged).join(',') === 'false,true');

    // 所有 interview 条目仍然恰好落一次
    const seen = new Map<string, number>();
    for (const th of grouped) for (const i of th.items) seen.set(i.id, (seen.get(i.id) ?? 0) + 1);
    t('分组之后一条不丢、不重', seen.size === items.length && [...seen.values()].every((n) => n === 1));
    t('没被收走的仍然一条一段', grouped.filter((th) => !th.grouped).every((th) => th.items.length === 1));

    // 搜索命中任意一段；item → thread 能映射回来（今日推荐胶囊要用）
    const chain = amazon[2];
    const followup = chain.items[3];
    t(
      '搜追问的题面也能命中整条链',
      matchesFilter(toRow(chain), { ...EMPTY_FILTER, query: (followup.question || '').slice(0, 20).toLowerCase() }),
    );
    t('item → thread 映射回得去', threadOfItem(grouped, followup.id)?.thread.thread_id === chain.thread.thread_id);
    t('同场次邻居按主问题 id 排', threadSiblings(grouped, amazon[0]).length === 4);
    t('行标签里的追问数走链', toRow(chain).followupCount === 5);
    // 'Q3' 只有一个词 → 走废话题面规则，落到中文标题上；这正是期望行为。
    t('链标题优先用分组表给的（短英文标题让位给中文）', toRow(chain).title === '第 3 问');
    const longTitled = buildThreads(items, [
      { ...sample[2], title: 'Tell me about a time you had to learn a new domain fast.', title_zh: '中文标题' },
    ]).find((th) => th.grouped)!;
    t(
      '正常长度的链标题直接用',
      toRow(longTitled).title === 'Tell me about a time you had to learn a new domain fast.' &&
        toRow(longTitled).subtitle === '中文标题',
    );
  }

  // 今日推荐胶囊：截断了必须补省略号，不然读起来像句子写坏了。
  {
    const long = items.find((i) => (i.question_zh || i.question || i.id).length > 26);
    if (long) {
      const label = queueChipLabel(long);
      t('长标题截断补省略号', label.length === 27 && label.endsWith('…'));
    }
    const short = items.find((i) => (i.question_zh || i.question || i.id).length <= 26);
    if (short) t('短标题不动', !queueChipLabel(short).endsWith('…'));
  }
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall selftests passed');
