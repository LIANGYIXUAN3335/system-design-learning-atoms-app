import { State } from './srs';
import { addLocalDays, localDateStr } from './dates';
import type { SrsEntry } from './queue';
import type { AtomType, Card } from '../types';

/**
 * 「游戏的劲儿」第 1 批 + A1 的纯逻辑（docs/DESIGN_game-feel_2026-10-11.md §7 拍板口径）。
 * 这里只放算数；震动、声音、动画在 src/feel.ts 和 src/components/GameFeel.tsx。
 */

export const ATOM_TYPES: AtomType[] = ['fact', 'fit', 'contrast', 'consequence', 'number'];

/** A1：某个卡型样本少于这么多条，就不信它的中位数，改用兜底秒数。 */
export const TIMER_MIN_SAMPLES = 20;
/** A1：样本不够时的兜底基准秒数。 */
export const TIMER_FALLBACK_SEC = 15;
/**
 * 读题环的长度：所有卡型统一 60 秒（2026-10-12 她拍板）。
 * 以前用「历史中位数 × 3」，结果 151 / 180 / 251 秒随卡型乱跳；中位数本身就含翻面后看解析
 * 的时间，再乘 3 是双重放宽。环走完**不翻面、不扣分**，数字改成正计时继续走。
 */
export const READING_TIMER_SEC = 60;
/** A5：一组最多这么多张。队列再长，首页也只报这一组，剩下的不提。 */
export const PLAN_CHUNK = 60;
/** B4 / A3「今天坚持了几分钟」：单张卡最多算这么久，防止把手机放一边的时间也算进去。 */
export const MAX_COUNTED_MS_PER_CARD = 10 * 60_000;
/** A2 大档：连续天数到这几个数时，结算画面额外点名。 */
export const STREAK_MILESTONES = [7, 30, 100];

export function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface TypicalTime {
  /** 基准毫秒：样本够就是她的中位数，不够就是兜底 15 秒 */
  ms: number;
  samples: number;
  /** true = 用的是她自己的中位数；false = 兜底 */
  fromHistory: boolean;
}

export type TypicalTimes = Record<AtomType, TypicalTime>;

/**
 * A1 基准秒数：review_log 里每个卡型（atomType）的 elapsedMs 中位数。
 * 注意 elapsedMs 是「出题 → 点忘了/模糊/记得」的整张卡用时，含看解析的时间，
 * 当「一张卡要花多久」来估总时长正合适；读题环已经不用它（固定 60 秒），只剩 ⚡ 和估时在用。
 */
export function typicalTimesByType(
  samples: Array<{ cardId: string; elapsedMs: number | null }>,
  atomTypeOf: (cardId: string) => AtomType | undefined,
  minSamples: number = TIMER_MIN_SAMPLES,
  fallbackSec: number = TIMER_FALLBACK_SEC,
): TypicalTimes {
  const byType = new Map<AtomType, number[]>(ATOM_TYPES.map((t) => [t, []]));
  for (const s of samples) {
    if (s.elapsedMs == null || !(s.elapsedMs > 0)) continue;
    const type = atomTypeOf(s.cardId);
    if (!type) continue;
    byType.get(type)?.push(s.elapsedMs);
  }
  const out = {} as TypicalTimes;
  for (const type of ATOM_TYPES) {
    const list = byType.get(type) ?? [];
    const med = list.length >= minSamples ? median(list) : null;
    out[type] = med != null
      ? { ms: med, samples: list.length, fromHistory: true }
      : { ms: fallbackSec * 1000, samples: list.length, fromHistory: false };
  }
  return out;
}

export function defaultTypicalTimes(): TypicalTimes {
  return typicalTimesByType([], () => undefined);
}

/** 读题环的时长：固定 60 秒，跟卡型、历史用时无关；它不改变排期、得分或作答记录。 */
export function readingTimerMs(): number {
  return READING_TIMER_SEC * 1000;
}

/** A5「约 M 分钟」：这组每张卡按她该卡型的历史中位数加起来，向上取整，至少 1 分钟。 */
export function estimateMinutes(cardIds: string[], cardsById: Map<string, Card>, typical: TypicalTimes): number {
  if (!cardIds.length) return 0;
  let ms = 0;
  for (const id of cardIds) {
    const type = cardsById.get(id)?.atomType;
    ms += type ? typical[type].ms : TIMER_FALLBACK_SEC * 1000;
  }
  return Math.max(1, Math.ceil(ms / 60_000));
}

/** A5：一组的张数——队列超过 PLAN_CHUNK 就只拿前 PLAN_CHUNK 张。 */
export function planChunk<T>(queue: T[], chunk: number = PLAN_CHUNK): T[] {
  return queue.length > chunk ? queue.slice(0, chunk) : queue;
}

/**
 * A3「这组 y 张从忘记变成记住了」的判定。
 *
 * 用 src/logic 里现成的 FSRS 状态（srs.ts 的 State）：这次评分前还「没记住」——
 * New / Learning / Relearning——评完进了 Review，并且评分 ≥ Good，就算一张。
 * 为什么把 Learning 也算进来：ts-fsrs v5 默认有学习步，新卡第一次答「记得」只会进
 * Learning（不会直接进 Review，Easy 在这个 app 里不用），第二次再答对才进 Review；
 * 答错过的卡走 Relearning → Review。所以「New/Relearning → Review」字面上几乎只抓得到
 * 忘过的卡，加上 Learning 才能抓到「上次还没记住、这次记住了」的那一下。
 * 评分 ≥ Good 在 grading.ts 里意味着：客观答对（或填空自评）+ 自评「记得」；答错 / 看答案
 * 会被压成 Hard，不算。
 */
export function becameRemembered(prevState: State, nextState: State, rating: number): boolean {
  return prevState !== State.Review && nextState === State.Review && rating >= 3; // 3 = Rating.Good
}

/** A3「明天预计到期 N 张」：这个范围里到明天结束前会到期的复习卡（含今天还欠着的）。 */
export function dueByTomorrowCount(deckIds: Set<string>, srs: Map<string, SrsEntry>, now: Date): number {
  const tomorrow = localDateStr(addLocalDays(now, 1));
  let n = 0;
  for (const [id, e] of srs.entries()) {
    if (!deckIds.has(id)) continue;
    if (e.fsrs.state === State.New) continue;
    if (localDateStr(e.fsrs.due) <= tomorrow) n++;
  }
  return n;
}

/** 毫秒 → 「坚持了 N 分钟」的 N：有做就至少 1 分钟，四舍五入。 */
export function minutesFromMs(ms: number): number {
  if (!(ms > 0)) return 0;
  return Math.max(1, Math.round(ms / 60_000));
}

export function isStreakMilestone(streak: number): boolean {
  return STREAK_MILESTONES.includes(streak);
}

/**
 * A1 答对后的「⚡ 5 秒」：比她这个卡型的中位数快才显示；慢了什么都不说（§7 A3 精神：不渲染快慢）。
 */
export function fastAnswerNote(answerMs: number | null, baselineMs: number): string | null {
  if (answerMs == null || !(answerMs > 0) || answerMs >= baselineMs) return null;
  return `⚡ ${Math.max(1, Math.round(answerMs / 1000))} 秒`;
}
