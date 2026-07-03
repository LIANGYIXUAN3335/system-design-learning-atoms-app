import type { Card, Track } from '../types';

/**
 * Tracks (spec §4): a track is a saved tag filter with union semantics —
 * a card matches if it carries ANY `include` tag and none of `exclude`.
 * FSRS state is per-card, so switching tracks never touches progress.
 */

/** Built-in no-filter pseudo-track; lives in code, not in the DB. */
export const ALL_TRACK: Track = { id: 'all', name: '全部', include: [], builtin: true };

export function cardMatchesTrack(card: Card, track: Track): boolean {
  const tags = card.tags ?? [];
  if (track.exclude?.some((t) => tags.includes(t))) return false;
  if (track.include.length === 0) return true;
  return track.include.some((t) => tags.includes(t));
}

export function filterDeck(cards: Card[], track: Track): Card[] {
  if (track.include.length === 0 && !track.exclude?.length) return cards;
  return cards.filter((c) => cardMatchesTrack(c, track));
}

export function findTrack(tracks: Track[], id: string): Track {
  return tracks.find((t) => t.id === id) ?? ALL_TRACK;
}

/** slug for user-created tracks: 名字 → id (stable, collision-suffixed) */
export function trackIdFromName(name: string, existing: Track[]): string {
  const base =
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9一-鿿]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'track';
  let id = base;
  let i = 2;
  const taken = new Set(existing.map((t) => t.id));
  while (taken.has(id) || id === ALL_TRACK.id) id = `${base}-${i++}`;
  return id;
}
