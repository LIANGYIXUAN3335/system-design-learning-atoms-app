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

/** prototype-compatible feedback vocabulary: 忘了 and 不确定 both export as "unknown". */
export function toFeedbackGrade(self: SelfGrade): FeedbackGrade {
  return self === 'forgot' ? 'unknown' : self;
}
