import { State, type FsrsCard } from './srs';
import { localDateStr } from './dates';
import { shuffleWithMap } from './shuffle';
import { LEARN_AHEAD_MIN, NEW_PER_DAY } from '../config';
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
 * Due semantics (atoms-m1-review.md §3.3 / §6):
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
 * count — the M2a planner paces each track independently (atoms-m2a-review.md §2.4).
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
 * new cards. The date-seeded shuffle avoids serving one source chapter at a
 * time while keeping refreshes on the same day from reshuffling underneath you.
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
    .map((c, index) => ({ id: c.id, index, key: newCardSortKey(c.id, today) }))
    .sort((a, b) => a.key - b.key || a.index - b.index)
    .slice(0, quota)
    .map((c) => c.id);

  return [...due, ...fresh];
}

/**
 * Session-start ordering: due reviews KEEP buildQueue's oldest-due-first order
 * (the spaced-repetition contract — overdue debt is served first), only the
 * new-card tail is shuffled for per-session variety. Mode-agnostic: a
 * review-only list has an empty tail, a new-only list an empty head.
 */
export function orderSessionQueue(
  ids: string[],
  srs: Map<string, SrsEntry>,
  rand: () => number = Math.random,
): string[] {
  const dues = ids.filter((id) => srs.has(id));
  const news = ids.filter((id) => !srs.has(id));
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
