import type { Card, FeedbackExportItem, FeedbackRow } from '../types';

/**
 * Export shape and inclusion rule follow the prototype / design doc §13:
 * a card is exported if it has any flag, a term, a note, or a weak grade
 * (unknown / fuzzy). This JSON is the input to /atomize Mode 2 (feedback → cards).
 */
export function buildFeedbackExport(
  cards: Card[],
  feedback: Map<string, FeedbackRow>,
): FeedbackExportItem[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const out: FeedbackExportItem[] = [];
  for (const [cardId, f] of feedback.entries()) {
    const card = byId.get(cardId);
    if (!card) continue;
    const weak = f.grade === 'unknown' || f.grade === 'fuzzy';
    if (!f.flags.length && !f.term && !f.note && !weak) continue;
    out.push({
      id: cardId,
      sub: card.sub,
      atomType: card.atomType,
      q: card.q,
      grade: f.grade,
      flags: f.flags,
      term: f.term,
      note: f.note,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
