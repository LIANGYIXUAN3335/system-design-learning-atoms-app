import { FINAL_STRETCH_DAYS, NEW_PER_DAY, RECOMMENDED_NEW_PER_DAY } from '../config';
import { daysBetweenLocal } from './dates';

/**
 * Planner (spec §3): interview date + track size + mastery →
 * newPerDay = max(ceil((N − mastered) / (D × 0.8)), 1).
 * The 0.8 leaves slack for the review tail near the date; values over the
 * recommended pace warn but are not capped.
 *
 * On the interview day (or past it) the queue takes NO new cards — the
 * warning says "只刷复习" and newPerDay must agree with it, not fight it.
 */

export interface PlannerInput {
  /** interview date YYYY-MM-DD, or null = no deadline */
  targetDate: string | null;
  /** cards in the active track */
  deckSize: number;
  /** mastered cards in the active track (Review state, stability ≥ threshold) */
  mastered: number;
  now: Date;
}

export interface PlannerResult {
  newPerDay: number;
  /** whole days until the interview (0 = today or past), null when no date set */
  daysLeft: number | null;
  /** calculated value before any floor; null when no date set or review-only */
  raw: number | null;
  warning: string | null;
}

export function planNewPerDay(input: PlannerInput): PlannerResult {
  const { targetDate, deckSize, mastered, now } = input;

  if (!targetDate) {
    return { newPerDay: NEW_PER_DAY, daysLeft: null, raw: null, warning: null };
  }

  const diff = daysBetweenLocal(now, targetDate);
  if (diff <= 0) {
    return {
      newPerDay: 0,
      daysLeft: 0,
      raw: null,
      warning:
        diff < 0
          ? '面试日期已过——今天只清复习；记得更新日期'
          : '面试就是今天——只清复习，不再引入新卡',
    };
  }

  const remaining = Math.max(0, deckSize - mastered);
  const raw = Math.ceil(remaining / (diff * 0.8));
  const newPerDay = Math.max(raw, 1);

  const warning =
    raw > RECOMMENDED_NEW_PER_DAY
      ? `按目标要每天 ${raw} 张新卡，超过推荐节奏 ${RECOMMENDED_NEW_PER_DAY}——可以冲刺，或延后日期/缩小路径范围`
      : null;

  return { newPerDay, daysLeft: diff, raw, warning };
}

/**
 * Deadline-scaled floor, in days, for a "correct + 模糊" card (M3 §3.2 Phase 2).
 * Scales with pressure (newPerDay ≈ cards-left ÷ days-left): many cards / few days
 * → longer floor so reviews don't crowd out breadth; few cards / more days →
 * shorter floor so shaky cards get reinforced sooner. Clamped to 2–14 days; at the
 * recommended pace (and when no interview date is set) it lands on 4 — the value
 * Phase 1 shipped as the fixed default.
 */
export function deadlineFloorDays(newPerDay: number): number {
  const scaled = Math.round((4 * newPerDay) / RECOMMENDED_NEW_PER_DAY);
  return Math.min(14, Math.max(2, scaled));
}

/** Final stretch = the last few days before the interview (M3 §3.2 Phase 3);
 *  day 0 / past is the planner's review-only case, handled separately. */
export function isFinalStretch(daysLeft: number | null): boolean {
  return daysLeft !== null && daysLeft > 0 && daysLeft <= FINAL_STRETCH_DAYS;
}
