// Canonical card schema — see atoms-m1-review.md §2.1 for how the three
// divergent doc/prototype schemas were reconciled into this one.

export type CardFormat = 'mcq' | 'multi' | 'cloze' | 'chain' | 'code';
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
  codeSample?: string;
  lang?: string;
  /** build-time metadata for navigation; source JSONs do not need to carry it */
  track?: string;
  category?: string;
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
  origin?: 'seed' | 'ai';
  reviewed?: boolean;
  generatedBy?: 'source' | 'feedback';
  sourceCardId?: string;
  createdAt?: string;
  source?: { provider?: string; ref?: string };
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
