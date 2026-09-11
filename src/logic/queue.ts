import { State, type FsrsCard } from './srs';
import { localDateStr } from './dates';
import { shuffleWithMap } from './shuffle';
import { LEARN_AHEAD_MIN, MASTERED_STABILITY_DAYS, NEW_PER_DAY } from '../config';
import type { Card } from '../types';

export interface SrsEntry {
  fsrs: FsrsCard;
  /** local date the card was first answered (counts against the daily new quota) */
  firstSeen: string;
}

export interface QueueOpts {
  newPerDay?: number;
  learnAheadMin?: number;
  /** Cards already graded today; they leave today's study debt until tomorrow. */
  reviewedToday?: Set<string>;
  /** A named roadmap should introduce cards in its authored source order. */
  useRoadmapOrder?: boolean;
}

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function newCardSortKey(cardId: string, day: string): number {
  return hashString(`${day}:${cardId}`);
}

/**
 * Due semantics (docs/history/m1-review.md §3.3 / §6):
 *  - Review-state cards are day-granular: due if their due DATE is today or earlier.
 *  - Learning/Relearning cards are minute-granular: due if within the learn-ahead window.
 *  - New-state rows don't occur (a row is only written after the first review).
 */
export function isDueNow(c: FsrsCard, now: Date, learnAheadMin: number = LEARN_AHEAD_MIN): boolean {
  switch (c.state) {
    case State.Review:
      return localDateStr(c.due) <= localDateStr(now);
    case State.Learning:
    case State.Relearning:
      return c.due.getTime() <= now.getTime() + learnAheadMin * 60_000;
    default:
      return false;
  }
}

/**
 * Cards first answered today. When `withinIds` is given, only those cards
 * count — the M2a planner paces each track independently (docs/history/m2a-review.md §2.4).
 */
export function introducedTodayCount(
  srs: Map<string, SrsEntry>,
  now: Date,
  withinIds?: Set<string>,
): number {
  const today = localDateStr(now);
  let n = 0;
  for (const [id, e] of srs.entries()) {
    if (withinIds && !withinIds.has(id)) continue;
    if (e.firstSeen === today) n++;
  }
  return n;
}

/**
 * Daily queue = due reviews (oldest due first), then a stable daily sample of
 * new cards. Generic decks use a date-seeded shuffle so a refresh stays stable
 * without serving one source chapter at a time. A named roadmap may instead
 * opt into its authored source order.
 */
export function buildQueue(
  cards: Card[],
  srs: Map<string, SrsEntry>,
  now: Date,
  opts: QueueOpts = {},
): string[] {
  const newPerDay = opts.newPerDay ?? NEW_PER_DAY;
  const learnAhead = opts.learnAheadMin ?? LEARN_AHEAD_MIN;
  const reviewedToday = opts.reviewedToday ?? new Set<string>();
  const ids = new Set(cards.map((c) => c.id));

  const due = [...srs.entries()]
    .filter(([id, e]) => ids.has(id) && !reviewedToday.has(id) && isDueNow(e.fsrs, now, learnAhead))
    .sort((a, b) => a[1].fsrs.due.getTime() - b[1].fsrs.due.getTime())
    .map(([id]) => id);

  const quota = Math.max(0, newPerDay - introducedTodayCount(srs, now, ids));
  const today = localDateStr(now);
  const fresh = cards
    .filter((c) => !reviewedToday.has(c.id) && !srs.has(c.id))
    .map((c, index) => ({ id: c.id, index, key: newCardSortKey(c.id, today), roadmapOrder: c.roadmapOrder }))
    .sort((a, b) => {
      if (opts.useRoadmapOrder) {
        const aOrder = a.roadmapOrder ?? Number.MAX_SAFE_INTEGER;
        const bOrder = b.roadmapOrder ?? Number.MAX_SAFE_INTEGER;
        return aOrder - bOrder || a.index - b.index;
      }
      return a.key - b.key || a.index - b.index;
    })
    .slice(0, quota)
    .map((c) => c.id);

  return [...due, ...fresh];
}

/** Weak-set membership for the final-stretch sweep (M3 §3.2 Phase 3): a seen card
 *  that isn't mastered yet (Review state with stability ≥ threshold). Cards the
 *  learner keeps marking 模糊 stay low-stability, so they surface here. */
export function isWeak(e: SrsEntry, masteredStabilityDays: number = MASTERED_STABILITY_DAYS): boolean {
  return !(e.fsrs.state === State.Review && e.fsrs.stability >= masteredStabilityDays);
}

/**
 * Final-stretch queue (M3 §3.2 Phase 3): in the last days before the interview we
 * stop new cards and drill the weak set — every seen-but-not-mastered card,
 * weakest first (lowest stability, then most lapses), regardless of due date — so
 * the final pass shores up gaps instead of adding breadth. `limit` caps the sweep.
 */
export function buildWeakSweepQueue(
  cards: Card[],
  srs: Map<string, SrsEntry>,
  opts: { limit?: number; reviewedToday?: Set<string>; masteredStabilityDays?: number } = {},
): string[] {
  const reviewedToday = opts.reviewedToday ?? new Set<string>();
  const masteredDays = opts.masteredStabilityDays ?? MASTERED_STABILITY_DAYS;
  const ids = new Set(cards.map((c) => c.id));
  const weak = [...srs.entries()]
    .filter(([id, e]) => ids.has(id) && !reviewedToday.has(id) && isWeak(e, masteredDays))
    .sort((a, b) => a[1].fsrs.stability - b[1].fsrs.stability || b[1].fsrs.lapses - a[1].fsrs.lapses)
    .map(([id]) => id);
  return opts.limit != null ? weak.slice(0, opts.limit) : weak;
}

/**
 * Session-start ordering: due reviews KEEP buildQueue's oldest-due-first order
 * (the spaced-repetition contract — overdue debt is served first). Generic
 * decks shuffle the new-card tail for session variety; roadmap modules retain
 * their authored new-card sequence. Mode-agnostic: a review-only list has an
 * empty tail, a new-only list an empty head.
 */
export function orderSessionQueue(
  ids: string[],
  srs: Map<string, SrsEntry>,
  rand: () => number = Math.random,
  opts: { roadmapOrderById?: ReadonlyMap<string, number> } = {},
): string[] {
  const dues = ids.filter((id) => srs.has(id));
  const news = ids.filter((id) => !srs.has(id));
  if (opts.roadmapOrderById) {
    news.sort((a, b) => {
      const aOrder = opts.roadmapOrderById?.get(a) ?? Number.MAX_SAFE_INTEGER;
      const bOrder = opts.roadmapOrderById?.get(b) ?? Number.MAX_SAFE_INTEGER;
      return aOrder - bOrder || a.localeCompare(b);
    });
    return [...dues, ...news];
  }
  return [...dues, ...shuffleWithMap(news, rand).items];
}

/**
 * Mid-session requeue sweep (extracted from SessionScreen so it's testable):
 * cards that became due since the queue was built (the just-lapsed card,
 * learning steps maturing into the learn-ahead window) are appended to the
 * session. `scope` bounds the sweep to the session's universe — the deck for
 * an 'all' session, the initial queue's ids for a 'review'/'new' session, so
 * a mode-filtered session is never flooded with cards the user excluded.
 */
export function dueAdditions(
  srs: Map<string, SrsEntry>,
  scope: Set<string>,
  exclude: Set<string>,
  now: Date,
  learnAheadMin: number = LEARN_AHEAD_MIN,
): string[] {
  const additions: string[] = [];
  for (const [id, e] of srs.entries()) {
    if (!scope.has(id) || exclude.has(id)) continue;
    if (isDueNow(e.fsrs, now, learnAheadMin)) additions.push(id);
  }
  return additions;
}

/**
 * Remove the card currently shown in a live study queue. The next unseen card
 * takes the same slot, so removing a card never rewinds the learner or counts
 * as an answer. `nextIndex: null` means the current card was the final card.
 */
export function removeCurrentQueueCard(
  queue: readonly string[],
  currentIndex: number,
): { queue: string[]; nextIndex: number | null } {
  if (currentIndex < 0 || currentIndex >= queue.length) {
    return { queue: [...queue], nextIndex: null };
  }

  const nextQueue = [...queue.slice(0, currentIndex), ...queue.slice(currentIndex + 1)];
  return {
    queue: nextQueue,
    nextIndex: currentIndex < nextQueue.length ? currentIndex : null,
  };
}

/** Cards not due now but coming due later today (drives "稍后还有 N 张" on Today/Done). */
export function laterTodayCount(
  cards: Card[],
  srs: Map<string, SrsEntry>,
  now: Date,
  learnAheadMin: number = LEARN_AHEAD_MIN,
  reviewedToday: Set<string> = new Set<string>(),
): number {
  const ids = new Set(cards.map((c) => c.id));
  const today = localDateStr(now);
  let n = 0;
  for (const [id, e] of srs.entries()) {
    if (!ids.has(id)) continue;
    if (reviewedToday.has(id)) continue;
    if (isDueNow(e.fsrs, now, learnAheadMin)) continue;
    if (e.fsrs.state === State.New) continue;
    if (localDateStr(e.fsrs.due) === today) n++;
  }
  return n;
}
