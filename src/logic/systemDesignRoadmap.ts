import type { Card } from '../types';

export const CLASSIC_SYSTEM_DESIGN_TRACK_ID = 'classic-sd';
export const ALL_SYSTEM_DESIGN_ROADMAP_STAGE = 'all';

export type SystemDesignRoadmapPhase = '首轮' | '深挖' | '补漏';

export interface SystemDesignRoadmapStage {
  id: string;
  tag: string;
  label: string;
  phase: SystemDesignRoadmapPhase;
}

/**
 * A navigation map inside the one classic-system-design track. The tags are
 * build-time metadata only: they do not create a second set of tracks or a
 * second copy of a card's FSRS state.
 */
export const SYSTEM_DESIGN_ROADMAP: SystemDesignRoadmapStage[] = [
  { id: 'sd-00-framework', tag: 'curriculum:sd-00-framework', label: '01 答题骨架', phase: '首轮' },
  { id: 'sd-01-patterns', tag: 'curriculum:sd-01-patterns', label: '02 五大 Pattern', phase: '首轮' },
  { id: 'sd-02-components', tag: 'curriculum:sd-02-components', label: '03 核心组件', phase: '首轮' },
  { id: 'sd-03-cases', tag: 'curriculum:sd-03-cases', label: '04 六道代表题', phase: '首轮' },
  { id: 'sd-04-upgrades', tag: 'curriculum:sd-04-upgrades', label: '05 追问升级', phase: '首轮' },
  { id: 'sd-10-foundations', tag: 'curriculum:sd-10-foundations', label: '06 面试基本功', phase: '深挖' },
  { id: 'sd-11-patterns-full', tag: 'curriculum:sd-11-patterns-full', label: '07 Pattern 全量', phase: '深挖' },
  { id: 'sd-12-data-storage', tag: 'curriculum:sd-12-data-storage', label: '08 数据与存储', phase: '深挖' },
  { id: 'sd-13-platform-network', tag: 'curriculum:sd-13-platform-network', label: '09 API 与网络', phase: '深挖' },
  { id: 'sd-14-product-systems', tag: 'curriculum:sd-14-product-systems', label: '10 产品系统题', phase: '深挖' },
  { id: 'sd-15-reference', tag: 'curriculum:sd-15-reference', label: '11 原典精读', phase: '深挖' },
  { id: 'sd-99-gap-fill', tag: 'curriculum:sd-99-gap-fill', label: '12 全库补漏', phase: '补漏' },
];

export const DEFAULT_SYSTEM_DESIGN_ROADMAP_STAGE = SYSTEM_DESIGN_ROADMAP[0].id;

export function isSystemDesignRoadmapStageId(id: string): boolean {
  return id === ALL_SYSTEM_DESIGN_ROADMAP_STAGE || SYSTEM_DESIGN_ROADMAP.some((stage) => stage.id === id);
}

export function normalizeSystemDesignRoadmapStage(id: string): string {
  return isSystemDesignRoadmapStageId(id) ? id : DEFAULT_SYSTEM_DESIGN_ROADMAP_STAGE;
}

export function filterSystemDesignRoadmapStage(cards: Card[], stageId: string): Card[] {
  if (stageId === ALL_SYSTEM_DESIGN_ROADMAP_STAGE) return cards;
  const stage = SYSTEM_DESIGN_ROADMAP.find((item) => item.id === stageId);
  return stage ? cards.filter((card) => card.tags?.includes(stage.tag)) : cards;
}

export function legacyTrackToRoadmapStage(id: string): string | null {
  const legacy = id.replace(/^sd-path-/, 'sd-');
  return isSystemDesignRoadmapStageId(legacy) ? legacy : null;
}
