/**
 * Display-order shuffling with an index map back to the authored order.
 *
 * 26 of the 29 choice cards in the seed deck put the correct answer at
 * index 1 ("B") — without per-render shuffling, spaced repetition would
 * teach "pick B" instead of the content (docs/history/m1-review.md §3.1).
 * Grading always happens in ORIGINAL indexes; only display order varies.
 */
export interface Shuffled<T> {
  /** items in display order: items[k] === original[toOriginal[k]] */
  items: T[];
  toOriginal: number[];
}

export function shuffleWithMap<T>(original: T[], rand: () => number = Math.random): Shuffled<T> {
  const idx = original.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return { items: idx.map((i) => original[i]), toOriginal: idx };
}
