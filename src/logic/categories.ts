import { MASTERED_STABILITY_DAYS } from '../config';
import type { Card } from '../types';
import type { SrsEntry } from './queue';
import { State } from './srs';

export const ALL_CATEGORY = 'all';

export interface CategoryStat {
  id: string;
  name: string;
  total: number;
  /** cards mastered (Review state, stability ≥ threshold) — depth */
  mastered: number;
  /** cards answered at least once (has an SRS row) — coverage / breadth */
  seen: number;
}

/** Coverage status of a topic chip — breadth, not depth: never touched vs
 *  partway vs every card seen. Drives the status dot + "pick what's left" sort. */
export type CategoryStatus = 'not-started' | 'in-progress' | 'covered';

export function categoryStatus(stat: { seen: number; total: number }): CategoryStatus {
  if (stat.total > 0 && stat.seen >= stat.total) return 'covered';
  if (stat.seen > 0) return 'in-progress';
  return 'not-started';
}

function isMastered(entry: SrsEntry | undefined): boolean {
  return Boolean(entry?.fsrs.state === State.Review && entry.fsrs.stability >= MASTERED_STABILITY_DAYS);
}

export function filterByCategory(cards: Card[], category: string): Card[] {
  if (category === ALL_CATEGORY) return cards;
  return cards.filter((card) => (card.category ?? 'Uncategorized') === category);
}

export function buildCategoryStats(cards: Card[], srs: Map<string, SrsEntry>): CategoryStat[] {
  const byCategory = new Map<string, CategoryStat>();
  for (const card of cards) {
    const name = card.category ?? 'Uncategorized';
    const stat = byCategory.get(name) ?? { id: name, name, total: 0, mastered: 0, seen: 0 };
    stat.total++;
    const entry = srs.get(card.id);
    if (entry) stat.seen++;
    if (isMastered(entry)) stat.mastered++;
    byCategory.set(name, stat);
  }

  // Covered topics sink to the end so the ones you still need bubble up front.
  const coveredRank = (s: CategoryStat) => (categoryStatus(s) === 'covered' ? 1 : 0);
  return [...byCategory.values()].sort(
    (a, b) => coveredRank(a) - coveredRank(b) || b.total - a.total || a.name.localeCompare(b.name),
  );
}

