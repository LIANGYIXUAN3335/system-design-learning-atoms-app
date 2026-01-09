import { localDateStr } from './dates';

/**
 * Motivation layer (spec §2), derived entirely from review_log — no new tables.
 *
 * Streak: forgiving on purpose (spec §11.5) — a day counts if ≥1 review
 * happened. Whether a past day's queue was "cleared" is not reconstructible
 * from the log (queue composition was never snapshotted), so ≥1-review is
 * both the derivable and the demotivation-safe reading (docs/history/m2a-review.md §2.1).
 * Anchor: if today has no reviews yet, the walk starts at yesterday, so a
 * morning glance doesn't show 0 before you've studied.
 */
export function computeStreak(studiedDays: Set<string>, now: Date): number {
  const cursor = new Date(now);
  if (!studiedDays.has(localDateStr(cursor))) cursor.setDate(cursor.getDate() - 1);
  let n = 0;
  while (studiedDays.has(localDateStr(cursor))) {
    n++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}

export interface DailyGoal {
  /** distinct cards answered today within the active track */
  done: number;
  /** done + still due now + remaining new quota (monotone within the day) */
  target: number;
}

/**
 * Daily goal ring. The spec's literal `due + newPerDay` shrinks as you study;
 * this equivalent keeps the denominator stable and hits 100% exactly when
 * the day's queue is cleared (docs/history/m2a-review.md §2.2). Re-lapsed cards
 * count once because `done` is a distinct-card count.
 */
export function dailyGoal(distinctAnsweredToday: number, dueNowCount: number, newQuotaLeft: number): DailyGoal {
  return {
    done: distinctAnsweredToday,
    target: distinctAnsweredToday + dueNowCount + newQuotaLeft,
  };
}
