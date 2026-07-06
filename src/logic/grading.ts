import { Rating, type Grade } from 'ts-fsrs';
import type { SelfGrade, FeedbackGrade } from '../types';

/** mcq / multi / code: picked set (original indexes) must equal the answer set. */
export function choiceCorrect(answer: number[], pickedOriginal: Set<number>): boolean {
  return pickedOriginal.size === answer.length && answer.every((a) => pickedOriginal.has(a));
}

/** chain: exact match against answerOrder or any acceptAltOrders entry (original indexes). */
export function chainCorrect(
  answerOrder: number[],
  acceptAltOrders: number[][] | undefined,
  pickedOriginal: number[],
): boolean {
  const eq = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  if (eq(answerOrder, pickedOriginal)) return true;
  return (acceptAltOrders ?? []).some((alt) => eq(alt, pickedOriginal));
}

/**
 * Combine the subjective 3-button grade with the objective outcome
 * (atoms-m1-review.md §3.2):
 *   忘了 → Again · 模糊 → Hard · 记得 → Good,
 *   but 记得 is capped to Hard when the answer was objectively wrong or
 *   the card was revealed via 不确定. Cloze passes wasCorrect = null
 *   (self-assessed only, uncapped). Easy is deliberately unused.
 */
export function toFsrsRating(self: SelfGrade, wasCorrect: boolean | null, usedIdk: boolean): Grade {
  if (self === 'forgot') return Rating.Again;
  if (self === 'fuzzy') return Rating.Hard;
  return wasCorrect === false || usedIdk ? Rating.Hard : Rating.Good;
}

/**
 * Correctness-gated minimum interval, in days, before a card may reappear
 * (M3 §3.2). Objective correctness sets the floor; the self-grade only tunes it,
 * so a correctly-answered card never comes back tomorrow just because the learner
 * felt shaky — otherwise the review debt snowballs and crowds out new cards.
 * Only a wrong pick or 看答案/idk (a real retrieval gap) may return next-day.
 *
 * `correctFuzzyFloor` is the floor for "correct + 模糊": Phase 2 passes a
 * deadline-scaled value (≈ cards-left ÷ days-left); the default keeps it fixed.
 */
export function minIntervalDays(
  self: SelfGrade,
  wasCorrect: boolean | null,
  usedIdk: boolean,
  correctFuzzyFloor = 4,
): number {
  if (wasCorrect === false || usedIdk) return 1; // real gap → may return tomorrow
  if (self === 'forgot') return wasCorrect === true ? 2 : 1; // correct-but-guessed vs self-forgot
  if (self === 'fuzzy') return Math.max(2, Math.round(correctFuzzyFloor)); // correct + shaky
  return 1; // 记得 → let FSRS's natural (already ≥ tomorrow) interval stand
}

/** prototype-compatible feedback vocabulary: 忘了 and 不确定 both export as "unknown". */
export function toFeedbackGrade(self: SelfGrade): FeedbackGrade {
  return self === 'forgot' ? 'unknown' : self;
}
