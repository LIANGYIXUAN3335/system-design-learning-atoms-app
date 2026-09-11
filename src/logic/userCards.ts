import type { Card } from '../types';

export interface SupplementInput {
  title: string;
  explanation: string;
}

function cardId(parentId: string, now: Date, nonce: string): string {
  // Keeping the parent id as the prefix makes equal-roadmap-order cards sort
  // immediately after their source card in the existing session ordering.
  return `${parentId}--supplement-${now.getTime().toString(36)}-${nonce}`;
}

/** Build a learner-owned cloze card that stays beside the card that prompted it. */
export function createSupplementCard(
  source: Card,
  input: SupplementInput,
  now: Date = new Date(),
  nonce: string = Math.random().toString(36).slice(2, 8),
): Card {
  const title = input.title.trim();
  const explanation = input.explanation.trim();
  if (!title || !explanation) throw new Error('请写下补充知识点和解释。');

  const blank = title.replace(/[{}]/g, '').trim() || '这个知识点';
  const createdAt = now.toISOString();
  return {
    id: cardId(source.id, now, nonce),
    format: 'cloze',
    atomType: 'fact',
    topic: source.topic,
    sub: `补充 · ${source.sub}`,
    scenario: source.scenario ? `从「${source.q}」延伸出来的补充` : undefined,
    q: title,
    text: `合上笔记，先讲清 {{${blank}}}：定义、什么时候用、一个例子。`,
    why: explanation,
    why_en: '',
    track: source.track,
    category: source.category,
    roadmapOrder: source.roadmapOrder,
    tags: [...new Set([...(source.tags ?? []), 'personal:supplement'])],
    origin: 'user',
    generatedBy: 'user',
    sourceCardId: source.id,
    createdAt,
  };
}

/**
 * The shipped deck stays read-only. Learner cards are inserted after their
 * source card, while hidden ids are a private overlay rather than a mutation
 * to the shared content bundle.
 */
export function mergeCardLibrary(
  bundled: Card[],
  userCards: Card[],
  hiddenCardIds: ReadonlySet<string>,
): Card[] {
  const visibleUserCards = userCards.filter(
    (card) => !hiddenCardIds.has(card.id) && !(card.sourceCardId && hiddenCardIds.has(card.sourceCardId)),
  );
  const bySource = new Map<string, Card[]>();
  const unattached: Card[] = [];
  const bundledIds = new Set(bundled.map((card) => card.id));

  for (const card of visibleUserCards) {
    if (!card.sourceCardId || !bundledIds.has(card.sourceCardId)) {
      unattached.push(card);
      continue;
    }
    const cards = bySource.get(card.sourceCardId) ?? [];
    cards.push(card);
    bySource.set(card.sourceCardId, cards);
  }

  const merged: Card[] = [];
  for (const card of bundled) {
    if (hiddenCardIds.has(card.id)) continue;
    merged.push(card);
    merged.push(...(bySource.get(card.id) ?? []).sort((a, b) => a.id.localeCompare(b.id)));
  }
  merged.push(...unattached.sort((a, b) => a.id.localeCompare(b.id)));
  return merged;
}
