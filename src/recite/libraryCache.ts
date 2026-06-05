import { EMPTY_FILTER, type LibraryFilter } from './library';
import type { ReciteOverview } from './types';

/**
 * 总库那一页的「回来还是原样」缓存。
 *
 * 她的动线是「库 → 练一条 → ← 总库 → 练下一条」，一轮能来回十几次。练习页一挂载库就
 * unmount，如果状态跟着组件走，每次回来都是：搜索框清空、分组重新折起、overview 重新拉一次。
 * 所以搜索/展开/滚动位置和 overview 全放模块级 —— 它是这一段动线的缓存，不是学习状态，
 * 不进 SQLite，进程结束就没了。
 *
 * overview 只在两种时候重新拉：评过一次分（箱位/录过次数变了 → `markOverviewStale()`），
 * 或者她自己点「刷新」。
 */

export interface LibraryCache {
  filter: LibraryFilter;
  /** 被收起来的段（三段里只有「其他」默认在里面） */
  closedSections: Set<string>;
  /** 展开着的公司，键是 `段//公司` —— 同一家公司会同时出现在有原声段和 playbook 段 */
  openCo: Set<string>;
  /** 场次默认全开，所以记的是被收起来的那些，键是 `段//公司//场次` */
  closedSes: Set<string>;
  scrollY: number;
  overview: ReciteOverview | null;
  /** overview 是不是过期了（评分改了状态之后置 true） */
  stale: boolean;
  /** 第一家公司默认展开只做一次，之后听她的 */
  seeded: boolean;
}

const cache: LibraryCache = {
  filter: EMPTY_FILTER,
  closedSections: new Set(['other']),
  openCo: new Set(),
  closedSes: new Set(),
  scrollY: 0,
  overview: null,
  stale: true,
  seeded: false,
};

export function libraryCache(): LibraryCache {
  return cache;
}

export function setLibraryFilter(filter: LibraryFilter): void {
  cache.filter = filter;
}

export function setLibraryGroups(
  openCo: Set<string>,
  closedSes: Set<string>,
  closedSections: Set<string>,
): void {
  cache.openCo = openCo;
  cache.closedSes = closedSes;
  cache.closedSections = closedSections;
}

export function setLibraryScrollY(y: number): void {
  cache.scrollY = y;
}

export function setLibraryOverview(overview: ReciteOverview): void {
  cache.overview = overview;
  cache.stale = false;
}

/** 评完分调一次：箱位、录过次数、今日队列都可能变了。 */
export function markOverviewStale(): void {
  cache.stale = true;
}

/** 第一段的第一家公司默认展开，只种一次；她自己收起来之后回来不该又被展开。 */
export function seedOpenCompany(key: string): void {
  if (cache.seeded) return;
  cache.seeded = true;
  cache.openCo = new Set([key]);
}
