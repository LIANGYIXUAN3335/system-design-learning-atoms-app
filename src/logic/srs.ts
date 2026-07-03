import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  State,
  type Card as FsrsCard,
  type Grade,
} from 'ts-fsrs';

// FSRS is the ONLY scheduler (M2 spec §1). The rhythm preset tunes it through
// request_retention; per-card state is untouched by a retention change, so
// switching rhythm mid-stream is safe and affects only future reviews.
let scheduler = fsrs(generatorParameters({ enable_fuzz: true }));
let currentRetention = 0.9;

export function setRequestRetention(retention: number): void {
  if (retention === currentRetention) return;
  currentRetention = retention;
  scheduler = fsrs(generatorParameters({ enable_fuzz: true, request_retention: retention }));
}

export function getRequestRetention(): number {
  return currentRetention;
}

export type { FsrsCard, Grade };
export { State };

export function emptyCard(now: Date): FsrsCard {
  return createEmptyCard(now);
}

export function applyReview(card: FsrsCard, now: Date, grade: Grade): FsrsCard {
  return scheduler.next(card, now, grade).card;
}

export function serializeFsrs(card: FsrsCard): string {
  return JSON.stringify(card);
}

export function deserializeFsrs(json: string): FsrsCard {
  const o = JSON.parse(json) as Record<string, unknown>;
  o.due = new Date(o.due as string);
  if (o.last_review) o.last_review = new Date(o.last_review as string);
  return o as unknown as FsrsCard;
}
