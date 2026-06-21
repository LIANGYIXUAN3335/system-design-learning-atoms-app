import { State } from './srs';
import type { SrsEntry } from './queue';
import { cardMatchesTrack } from './tracks';
import type { Card, Track } from '../types';

/**
 * 🗺 领地图的算数（2026-10-13 她拍板：按学习模块分格、三色、不放百分比）。
 * 行 = app 里的轨道（tracks.json），格 = 卡上的 category（build-deck 给每张卡标的学习模块）。
 * 三色：稳定 = 已进 Review 且 stability ≥ masteredDays（和首页「已掌握」同一把尺）；
 *       在学 = 碰过但还没稳；没碰 = 一条记录都没有。
 * 一格的颜色：稳定的占到 STABLE_SHARE 以上算「稳定」，否则只要碰过就是「在学」。
 */

export type CellStatus = 'stable' | 'learning' | 'untouched';
export const STABLE_SHARE = 0.8;

export interface TerritoryCell {
  category: string;
  cardIds: string[];
  total: number;
  stable: number;
  touched: number;
  status: CellStatus;
}

export interface TerritoryRow {
  trackId: string;
  trackName: string;
  cells: TerritoryCell[];
  total: number;
  stable: number;
  touched: number;
}

export function isStable(e: SrsEntry | undefined, masteredDays: number): boolean {
  return !!e && e.fsrs.state === State.Review && e.fsrs.stability >= masteredDays;
}

export function cellStatus(total: number, stable: number, touched: number): CellStatus {
  if (total > 0 && stable / total >= STABLE_SHARE) return 'stable';
  if (touched > 0) return 'learning';
  return 'untouched';
}

export function buildTerritory(
  cards: Card[],
  tracks: Track[],
  srs: Map<string, SrsEntry>,
  masteredDays: number,
): TerritoryRow[] {
  const rows: TerritoryRow[] = [];
  const taken = new Set<string>();
  for (const track of tracks) {
    const byCat = new Map<string, TerritoryCell>();
    for (const c of cards) {
      if (taken.has(c.id) || !cardMatchesTrack(c, track)) continue;
      taken.add(c.id);
      const cat = c.category || c.topic || '未分类';
      let cell = byCat.get(cat);
      if (!cell) {
        cell = { category: cat, cardIds: [], total: 0, stable: 0, touched: 0, status: 'untouched' };
        byCat.set(cat, cell);
      }
      const e = srs.get(c.id);
      cell.cardIds.push(c.id);
      cell.total++;
      if (e) cell.touched++;
      if (isStable(e, masteredDays)) cell.stable++;
    }
    if (!byCat.size) continue;
    const cells = [...byCat.values()]
      .map((cell) => ({ ...cell, status: cellStatus(cell.total, cell.stable, cell.touched) }))
      // 先稳定、再在学、最后没碰；同档内卡多的在前
      .sort((a, b) => rank(a.status) - rank(b.status) || b.total - a.total || a.category.localeCompare(b.category));
    rows.push({
      trackId: track.id,
      trackName: track.name,
      cells,
      total: cells.reduce((n, x) => n + x.total, 0),
      stable: cells.reduce((n, x) => n + x.stable, 0),
      touched: cells.reduce((n, x) => n + x.touched, 0),
    });
  }
  return rows;
}

function rank(s: CellStatus): number {
  return s === 'stable' ? 0 : s === 'learning' ? 1 : 2;
}

/** 格子宽度：卡越多越宽，但有上下限，免得一张卡的格子看不见、六千张的格子占一屏。 */
export function cellWidth(total: number, min: number = 72, max: number = 180): number {
  return Math.round(Math.min(max, min + Math.sqrt(Math.max(0, total)) * 9));
}
