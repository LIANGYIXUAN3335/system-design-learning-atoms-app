import { NEW_PER_DAY, RECOMMENDED_NEW_PER_DAY } from '../config';
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
