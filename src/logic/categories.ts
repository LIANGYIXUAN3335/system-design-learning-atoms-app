import { MASTERED_STABILITY_DAYS } from '../config';
import type { Card } from '../types';
import type { SrsEntry } from './queue';
import { State } from './srs';

export const ALL_CATEGORY = 'all';

export interface CategoryStat {
  id: string;
  name: string;
  total: number;
  mastered: number;
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
    const stat = byCategory.get(name) ?? { id: name, name, total: 0, mastered: 0 };
    stat.total++;
    if (isMastered(srs.get(card.id))) stat.mastered++;
    byCategory.set(name, stat);
  }

  return [...byCategory.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

