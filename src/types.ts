// Canonical card schema — see atoms-m1-review.md §2.1 for how the three
// divergent doc/prototype schemas were reconciled into this one.

export type CardFormat = 'mcq' | 'multi' | 'cloze' | 'chain' | 'code' | 'produce';
/**
 * 可交付的设计产物（2026-10-16 她拍板「少感悟、多产物」）：problem-breakdowns 的每张卡标一个，
 * 覆盖合同（docs/DESIGN_deliverable-cards_2026-10-16.md §2-B）靠它机检。
 */
export type Deliverable =
  | 'requirements'
  | 'entities'
  | 'schema'
  | 'api'
  | 'components'
  | 'flow'
  | 'state'
  | 'concurrency'
  | 'recovery'
  | 'capacity'
  | 'scaling'
  | 'tech';
export const DELIVERABLES: Deliverable[] = [
  'requirements', 'entities', 'schema', 'api', 'components', 'flow', 'state', 'concurrency', 'recovery', 'capacity', 'scaling', 'tech',
];
export const DELIVERABLE_LABEL: Record<Deliverable, string> = {
  requirements: '需求 / 澄清',
  entities: '核心实体',
  schema: 'Schema',
  api: 'API',
  components: '组件图',
  flow: '主流程',
  state: '状态机',
  concurrency: '并发 / 幂等',
  recovery: '故障恢复',
  capacity: '估算 / 瓶颈',
  scaling: '扩展瓶颈',
  tech: '技术选型',
};
export type AtomType = 'fact' | 'fit' | 'contrast' | 'consequence' | 'number';

export interface Card {
  id: string;
  format: CardFormat;
  atomType: AtomType;
  topic: string;
  sub: string;
  scenario?: string;
  /** English version of scenario, shown as small helper text under Chinese */
  scenario_en?: string;
  q: string;
  /** English version of q, shown as small helper text under Chinese */
  q_en?: string;
  /** mcq / multi / code */
  options?: string[];
  /** English versions of options, index-aligned (bilingual drill + TTS) */
  options_en?: string[];
  /** optional Mermaid specs aligned by option index; null means text-only */
  optionDiagrams?: Array<string | null>;
  /** optional Chinese "what this option is" notes aligned by option index */
  optionMeanings?: string[];
  /** optional Chinese "when this option is the better fit" notes aligned by option index */
  optionDirectness?: string[];
  /** optional Chinese "what choosing this means in the scenario" notes aligned by option index */
  optionScenarioImpacts?: string[];
  /** optional English "what this option is" notes aligned by option index */
  optionMeanings_en?: string[];
  /** optional English fit-context notes aligned by option index */
  optionDirectness_en?: string[];
  /** optional English scenario-impact notes aligned by option index */
  optionScenarioImpacts_en?: string[];
  /** optional Chinese explanations aligned by option index */
  optionExplanations?: string[];
  /** optional English explanations aligned by option index */
  optionExplanations_en?: string[];
  /** correct option indexes; single-answer formats have exactly one */
  answer?: number[];
  /** cloze text with {{blank}} markers */
  text?: string;
  /** English cloze text with {{blank}} markers aligned with text when present */
  text_en?: string;
  /**
   * produce（先写后揭晓）：她先在纸上写，翻面后逐条打勾的验收清单，3–6 条，每条当场能判真假。
   * 参考答案放 codeSample / diagram / table。
   */
  checklist?: string[];
  checklist_en?: string[];
  /** 这张卡交付的是哪种设计产物（problem-breakdowns 必标；其它 deck 可选） */
  deliverable?: Deliverable;
  /**
   * 只挂在「先澄清」produce 卡上：候选人贴出实际问法，Copilot 只审问到/漏掉的
   * 决策点，不代替她产出架构答案。
   */
  clarificationReview?: ClarificationReviewSpec;
  /** chain: steps as authored (already shuffled), reshuffled again per render */
  steps?: string[];
  answerOrder?: number[];
  acceptAltOrders?: number[][];
  why: string;
  why_en: string;
  whenOtherWins?: string;
  /** the one tradeoff axis this decision sits on, both sides named ("读路径延迟 vs 写路径预计算成本") */
  tradeoff?: string;
  /** card-local terms that must be explained even if the global glossary misses them */
  termDefinitions?: CardTermDefinition[];
  /** compact capacity/scalability anchors injected for database and infra cards */
  numberAnchors?: CardNumberAnchor[];
  /** Optional primary-source links shown after the answer is revealed. */
  references?: CardReference[];
  codeSample?: string;
  lang?: string;
  /** build-time metadata for navigation; source JSONs do not need to carry it */
  track?: string;
  category?: string;
  /**
   * Authored position inside the classic-system-design roadmap. It is injected
   * by the deck builder, so only a roadmap-scoped new-card queue uses it.
   */
  roadmapOrder?: number;
  /** Mermaid spec (visual atom) */
  diagram?: string;
  /** structured table (visual atom) — shape the ag/cr seed content actually ships */
  table?: CardTable;
  /**
   * open-ended tags; convention: topical tags plus `track:*` tags consumed by
   * track filters (atoms-m2a-review.md §2.8)
   */
  tags?: string[];
  // ---- provenance (spec §8; behavior lands with generation in M2c) ----
  origin?: 'seed' | 'ai' | 'user';
  reviewed?: boolean;
  generatedBy?: 'source' | 'feedback' | 'user';
  sourceCardId?: string;
  createdAt?: string;
  source?: { provider?: string; ref?: string };
}

export interface ClarificationReviewCriterion {
  /** Stable key used by the server response; not learner-facing by itself. */
  id: string;
  /** Short learner-facing decision area, e.g. "截止语义". */
  label: string;
  /** The question or decision a strong clarification phase should surface. */
  question: string;
  /** What later design choice changes if this remains unknown. */
  impact: string;
}

export interface ClarificationReviewSpec {
  /** Bumped when this card's server-owned rubric changes. */
  version: string;
  /** The full prompt as the interviewer gave it, kept on-card so review is grounded. */
  problem: string;
  /** Short, concrete instruction above the candidate input. */
  prompt: string;
  /** Maximum pasted characters; bounded before the request reaches the model. */
  maxChars: number;
  /** At most a handful of decision-changing questions, never a generic checklist. */
  rubric: ClarificationReviewCriterion[];
  /** The scope-lock assumptions the reviewer expects after questions are answered. */
  expectedAssumptions: string[];
}

export interface CardTable {
  headers: string[];
  rows: string[][];
}

export interface CardTermDefinition {
  term: string;
  /** expansion for abbreviations — "CRDT" → "Conflict-free Replicated Data Type" */
  fullName?: string;
  meaning: string;
  meaningEn?: string;
}

export interface CardNumberAnchor {
  system: string;
  unit: string;
  estimate: string;
  risk: string;
}

/** A compact, learner-facing primary source for a locally authored drill. */
export interface CardReference {
  title: string;
  url: string;
  /** Why this source matters for the current decision, not a generic citation. */
  note?: string;
}

/** A track = a saved tag filter (union semantics), spec §4. */
export interface Track {
  id: string;
  name: string;
  /** card matches if it has ANY of these tags; empty = match everything */
  include: string[];
  /** card excluded if it has ANY of these */
  exclude?: string[];
  /** code-defined (the "全部" pseudo-track) — not stored, not deletable */
  builtin?: boolean;
}

export type RhythmId = 'intensive' | 'normal' | 'relaxed';

/** User settings persisted in the settings KV table (spec §8). */
export interface AppSettings {
  /** interview date YYYY-MM-DD; null = no deadline (planner falls back to default pace) */
  targetDate: string | null;
  activeTrackId: string;
  /** selected stage inside the single classic-system-design track; 'all' = whole catalog */
  activeRoadmapStage: string;
  /** category display name within the active track; "all" = whole track */
  activeCategory: string;
  rhythm: RhythmId;
  remindersEnabled: boolean;
  /** "HH:MM" local */
  morningTime: string;
  /** "HH:MM" local — used by the intensive (早晚) rhythm */
  eveningTime: string;
  /** 答对「叮」、做完一组的音效（设置页「音效」）；默认开 */
  soundEnabled: boolean;
}

export type SelfGrade = 'forgot' | 'fuzzy' | 'got';
/** prototype-compatible feedback grade vocabulary (design doc §13) */
export type FeedbackGrade = 'unknown' | 'fuzzy' | 'got';
export type FlagKey = 'term' | 'hard' | 'easy' | 'more' | 'wrong';

export interface FeedbackRow {
  cardId: string;
  grade: FeedbackGrade | null;
  flags: FlagKey[];
  term: string;
  note: string;
  updatedAt: string;
}

/** one item of the exported feedback JSON — shape from design doc §13 */
export interface FeedbackExportItem {
  id: string;
  sub: string;
  atomType: AtomType;
  q: string;
  grade: FeedbackGrade | null;
  flags: FlagKey[];
  term: string;
  note: string;
}
