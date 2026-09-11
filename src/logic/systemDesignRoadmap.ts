import type { Card } from '../types';

export const CLASSIC_SYSTEM_DESIGN_TRACK_ID = 'classic-sd';
export const ALL_SYSTEM_DESIGN_ROADMAP_STAGE = 'all';

export type SystemDesignRoadmapPhase = 'Hello Interview' | '原典' | '我的';

export interface SystemDesignRoadmapStage {
  id: string;
  tag: string;
  label: string;
  phase: SystemDesignRoadmapPhase;
}

/**
 * A navigation map inside the one classic-system-design track. Each source
 * deck belongs to exactly one station; the tags and authored ordering are
 * build-time metadata only, never a second copy of a card's FSRS state.
 */
export const SYSTEM_DESIGN_ROADMAP: SystemDesignRoadmapStage[] = [
  { id: 'sd-01-hurry', tag: 'curriculum:sd-01-hurry', label: '01 速成指南', phase: 'Hello Interview' },
  { id: 'sd-02-core-concepts', tag: 'curriculum:sd-02-core-concepts', label: '02 核心概念', phase: 'Hello Interview' },
  { id: 'sd-03-patterns', tag: 'curriculum:sd-03-patterns', label: '03 七大 Pattern', phase: 'Hello Interview' },
  { id: 'sd-04-key-technologies', tag: 'curriculum:sd-04-key-technologies', label: '04 关键技术深挖', phase: 'Hello Interview' },
  { id: 'sd-05-problem-breakdowns', tag: 'curriculum:sd-05-problem-breakdowns', label: '05 真题白纸演练与拆解', phase: 'Hello Interview' },
  { id: 'sd-06-coach', tag: 'curriculum:sd-06-coach', label: '06 教练追问', phase: '我的' },
  { id: 'sd-07-mock-donation', tag: 'curriculum:sd-07-mock-donation', label: '07 模拟面试一 · 三天募捐', phase: '我的' },
  { id: 'sd-08-reference', tag: 'curriculum:sd-08-reference', label: '08 原典精读', phase: '原典' },
  { id: 'sd-09-recaps', tag: 'curriculum:sd-09-recaps', label: '09 我的复盘题', phase: '我的' },
];

export const DEFAULT_SYSTEM_DESIGN_ROADMAP_STAGE = SYSTEM_DESIGN_ROADMAP[0].id;

export function isSystemDesignRoadmapStageId(id: string): boolean {
  return id === ALL_SYSTEM_DESIGN_ROADMAP_STAGE || SYSTEM_DESIGN_ROADMAP.some((stage) => stage.id === id);
}

export const LEGACY_SYSTEM_DESIGN_ROADMAP_STAGE_ALIASES: Readonly<Record<string, string>> = {
  'sd-00-framework': 'sd-01-hurry',
  'sd-01-patterns': 'sd-03-patterns',
  'sd-02-components': 'sd-02-core-concepts',
  'sd-03-cases': 'sd-05-problem-breakdowns',
  'sd-04-upgrades': 'sd-06-coach',
  'sd-10-foundations': 'sd-01-hurry',
  'sd-11-patterns-full': 'sd-03-patterns',
  'sd-12-data-storage': 'sd-04-key-technologies',
  'sd-13-platform-network': 'sd-02-core-concepts',
  'sd-14-product-systems': 'sd-05-problem-breakdowns',
  'sd-15-reference': 'sd-08-reference',
  // The former catch-all had no coherent next station. Send it to the route
  // entrance rather than silently leaving the learner on a disappeared tab.
  'sd-99-gap-fill': 'sd-01-hurry',
  // 2026-10-26: this locally authored drill became a personal mock after the
  // coach station, so preserve a learner's intent across the tab renames.
  'sd-07-reference': 'sd-08-reference',
  'sd-08-recaps': 'sd-09-recaps',
};

export function normalizeSystemDesignRoadmapStage(id: string): string {
  const migrated = LEGACY_SYSTEM_DESIGN_ROADMAP_STAGE_ALIASES[id] ?? id;
  return isSystemDesignRoadmapStageId(migrated) ? migrated : DEFAULT_SYSTEM_DESIGN_ROADMAP_STAGE;
}

export function filterSystemDesignRoadmapStage(cards: Card[], stageId: string): Card[] {
  if (stageId === ALL_SYSTEM_DESIGN_ROADMAP_STAGE) return cards;
  const stage = SYSTEM_DESIGN_ROADMAP.find((item) => item.id === stageId);
  return stage ? cards.filter((card) => card.tags?.includes(stage.tag)) : cards;
}

export function legacyTrackToRoadmapStage(id: string): string | null {
  const legacy = id.replace(/^sd-path-/, 'sd-');
  if (LEGACY_SYSTEM_DESIGN_ROADMAP_STAGE_ALIASES[legacy]) {
    return LEGACY_SYSTEM_DESIGN_ROADMAP_STAGE_ALIASES[legacy];
  }
  return isSystemDesignRoadmapStageId(legacy) ? legacy : null;
}
