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
import { ALL_CATEGORY, buildCategoryStats, filterByCategory } from '../src/logic/categories';
import { deadlineFloorDays, isFinalStretch, planNewPerDay } from '../src/logic/planner';
import { computeStreak, dailyGoal } from '../src/logic/streak';
import { chooseConceptVisual, detectTerms } from '../src/logic/terms';
import { buildArchitectureVisual } from '../src/logic/architectureVisuals';
import { NEW_PER_DAY, RECOMMENDED_NEW_PER_DAY, RHYTHMS } from '../src/config';

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
  t(
    'seed tracks: 5, ids stable',
    seedTracks.length === 5 &&
      seedTracks.map((x) => x.id).join(',') === 'ai-coding,classic-sd,llm-sd,low-level-design,interview-drill',
  );
  t('bundle covers ai-coding seed track', filterDeck(bundle, seedTracks[0]).length >= 11);
  t('bundle covers classic-sd seed track', filterDeck(bundle, seedTracks[1]).length >= 600);
  t('bundle covers llm-sd seed track', filterDeck(bundle, seedTracks[2]).length >= 300);
  t('bundle covers low-level-design seed track', filterDeck(bundle, seedTracks[3]).length >= 700);
  t('trackIdFromName slugs + dedups', trackIdFromName('My Track', []) === 'my-track' && trackIdFromName('My Track', [{ id: 'my-track', name: '', include: [] }]) === 'my-track-2');
  const classicDeck = filterDeck(bundle, seedTracks[1]);
  const categories = buildCategoryStats(classicDeck, new Map());
  t('classic track has category groups', categories.length > 40 && categories.every((c) => c.total > 0));
  t('category filter scopes deck', filterByCategory(classicDeck, categories[0].id).length === categories[0].total);
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

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall selftests passed');
