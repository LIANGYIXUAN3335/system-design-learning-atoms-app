/**
 * 口语复盘（念稿练习）的数据契约。
 *
 * ReciteItem = docs/M4-recite.md §3.1（src/content/recite.bundle.json 里每一条）。
 * 其余是 atoms-recite 服务端的响应体，逐字对着 §3.3 的表写；改这里之前先改文档。
 */

export type ReciteSource = 'interview' | 'opener' | 'playbook' | 'reference';
export type RecitePointType = 'content' | 'form' | 'forbid' | 'canon';
export type ReciteVariantType = 'paraphrase' | 'constraint' | 'truncate' | 'transfer';

export interface RecitePoint {
  t: RecitePointType;
  text: string;
  probe: string;
}

/** bundle 里的候选变体。服务端返回的「当前这一遍要练的变体」多一个 'original'，见 ActiveVariant。 */
export interface ReciteVariant {
  type: ReciteVariantType;
  q: string;
  sec: number;
  hint: string;
}

export interface ReciteDialogTurn {
  sp: 'me' | 'iv';
  s: number;
  x: string;
  /** 中文翻译。翻译管线在产，导出补上之前是 undefined。 */
  zh?: string;
}

export interface ReciteDialog {
  t0: number;
  t1: number;
  truncated: boolean;
  turns: ReciteDialogTurn[];
}

export interface ReciteFollowup {
  x: string;
  s: number;
  source?: string;
}

export interface ReciteItem {
  id: string;
  source: ReciteSource;
  company: string;
  /** 归一后的短名（TikTok / ByteDance (…) → TikTok），分组标题用这个 */
  co: string;
  interview: string;
  kind: string;
  question: string;
  question_zh: string;
  /** null = 无念稿：听 + 看点评 */
  script: string | null;
  script_zh_gloss: string;
  canon_spans: string[];
  points: RecitePoint[];
  /** ≤4，coverage 的分母 */
  scored_idx: number[];
  /** 被截掉的 content，左栏灰字「加分项」 */
  extra_idx: number[];
  delivery_notes: string[];
  extra_cues: string[];
  orig_text: string;
  asr_dirty: boolean;
  critique_zh: string;
  debrief_line: string;
  followup_q: string;
  why_q: string;
  why_ref: string;
  target_sec: number;
  pace: 'deliberate' | null;
  variants: ReciteVariant[];
  story_id: string;
  link_group: string | null;
  quality: 'ok' | 'rough';
  deferred: boolean;
  scope: 'ok' | 'unknown' | 'thin';
  speaker_name: string;
  has_orig: boolean;
  has_dialog: boolean;
  dialog: ReciteDialog | null;
  dialog_followups: ReciteFollowup[];
  created_at: string;

  // ── 2026-09-03 加：稿子版本（M4 §3.1）────────────────────────────────────
  // base = 原 script；short = 1–2 分钟；long = 3–5 分钟。只有讲故事类的 BQ playbook
  // 条目有 long/short，其余为 null，练习页就不显示版本开关。
  // 内容管线还在补，导出重跑之前这几个键可能整个缺失 —— 所有读取都要按 `?? 兜底` 写。
  script_long: string | null;
  gloss_long: string;
  target_sec_long: number | null;
  script_short: string | null;
  gloss_short: string;
  target_sec_short: number | null;

  // ── 2026-09-03 加：题 + 追问链（thread）──────────────────────────────────
  // 她的原话：Amazon 那场 2–5 是同一个项目的不同追问，6–11 是第二问 —— 拆成一行一条是错的。
  // 库里的单位因此变成 thread：主问题 + 它的追问链。分组由 recite.threads.json 给，
  // 这三个字段是导出时盖的戳；没分组的条目 thread_id 为 null，各自成一条单段 thread。
  thread_id: string | null;
  thread_pos: number;
  thread_role: 'main' | 'followup';
}

export type ReciteThreadKind =
  | 'bq'
  | 'coding'
  | 'system-design'
  | 'ood'
  | 'self-intro'
  | 'qa'
  | 'other';

export interface ReciteThreadSegment {
  item_id: string;
  role: 'main' | 'followup';
  /** 「主问题」「追问 1」…… */
  label: string;
  /** 很短的追问：并进上一段里当子行渲染，不单独给稿和录音面板 */
  merge_into_prev?: boolean;
}

/** src/content/recite.threads.json 里的一条（M4 §3.1 的 thread 扩展）。 */
export interface ReciteThread {
  thread_id: string;
  interview: string;
  kind: ReciteThreadKind;
  title: string;
  title_zh: string;
  segments: ReciteThreadSegment[];
  /** 1–2 句：她在哪儿把人讲丢了 / 他为什么一直追问 —— 这才是她要练的东西 */
  chain_note_zh: string;
}

/** 这一遍念的是哪个版本。没有 long/short 的条目一律 'base'。 */
export type ScriptVersion = 'short' | 'long' | 'base';

// ── 服务端（atoms-recite）─────────────────────────────────────────────────────

/** Firestore `atoms/recite/state/{item_id}`。缺文档 = 默认（box 1，今天到期）。 */
export interface ReciteState {
  box?: number;
  due_on?: string;
  n_takes?: number;
  n_pass?: number;
  streak?: number;
  last_fail?: string | null;
  best_total?: number | null;
  last_total?: number | null;
  last_fix?: string | null;
  last_at?: string | null;
  needs_rewrite?: boolean;
  snooze_until?: string | null;
  archived?: boolean;
  exposed?: boolean;
  exposure_stage?: string | null;
  exposure_at?: string | null;
  scope_override?: string | null;
  updated_at?: string | null;
  /** 三遍练习法（2026-09-22）：跟读/闭眼/掐表 各存打勾时刻，null=没勾 */
  practice_shadow_at?: string | null;
  practice_blind_at?: string | null;
  practice_timed_at?: string | null;
}

export interface ReciteHistBucket {
  name: string;
  n: number;
  pass_rate: number;
}

export interface ReciteHistogram {
  buckets: ReciteHistBucket[];
  r_trend?: number[] | null;
  /** 近 40 次里她一共说了多少分钟 */
  spoken_min: number;
}

/** GET /recite/overview */
export interface ReciteOverview {
  today: string;
  calibrating: boolean;
  queue_ids: string[];
  state: Record<string, ReciteState>;
  n_takes: Record<string, number>;
  hist: ReciteHistogram;
  dupes: string[];
}

/** 服务端算出来的「这一遍练哪个说法」。type 'original' = 就练原题。 */
export interface ActiveVariant {
  type: ReciteVariantType | 'original';
  q: string;
  sec: number;
  hint: string;
}

export interface ReciteTakeSummary {
  take_id: string;
  ts: string;
  total: number | null;
  verdict: string | null;
  passed: boolean | null;
  audio_url: string;
  mode: ReciteMode;
  variant_type: string;
  /** 这一遍念的是哪一版。老 take 没有这个字段，当成 base（不显示标记）。 */
  version?: ScriptVersion;
}

/** GET /recite/items/:id */
export interface ReciteItemStatus {
  state: ReciteState;
  n_recorded: number;
  variant: ActiveVariant;
  first_exposure: boolean;
  calibrating: boolean;
  takes: ReciteTakeSummary[];
}

/** 盖稿开关：开 = 闭卷 recall（计过关/箱位），关 = 稿子在眼前 read。 */
export type ReciteMode = 'read' | 'recall';

/** POST /recite/items/:id/take 的 X-Recite-Meta（base64 JSON） */
export interface ReciteTakeMeta {
  mode: ReciteMode;
  variant_type: string;
  variant_sec: number;
  variant_q: string;
  variant_hint: string;
  first_exposure: boolean;
  self_est?: number | null;
  duration_sec: number;
  /** 念的是短版 / 长版 / 原稿 —— 判官要按这个版本的目标秒数看时长门 */
  version: ScriptVersion;
}

export interface ReciteUploadResult {
  take_id: string;
  saved: boolean;
  scored: boolean;
  audio_url: string;
}

export interface ReciteScores {
  structure?: number | null;
  concision?: number | null;
  fluency?: number | null;
  why_depth?: number | null;
}

export interface ReciteMetrics {
  asr_engine?: string;
  asr_error?: string;
  duration?: number;
  wpm?: number;
  pauses_over_2s?: number;
  hard_filler?: number;
  soft_filler?: number;
  [k: string]: unknown;
}

export interface ReciteFactCheck {
  said: string;
  note: string;
  provenance?: string;
}

/** POST /recite/takes/:id/rescore —— 和 jobscan `_score_take` 同形 */
export interface ReciteScoreResult {
  take_id: string;
  transcript: string;
  metrics: ReciteMetrics | null;
  verbatim_ratio: number | null;
  r_prev: number | null;
  fact_check: ReciteFactCheck[];
  scores: ReciteScores | null;
  issues?: string[];
  evidence?: string[];
  fix_next: string;
  one_line: string;
  judge_error?: string;
  state?: ReciteState;
  calibrating: boolean;
  coverage: number | null;
  total: number | null;
  verdict: string;
  hard_ok?: boolean;
  passed?: boolean;
  gate_note: string;
  dur_gate?: boolean;
  coverage_gate?: boolean;
  r_is_flag?: boolean;
  red_flags: string[];
  forbid_hits?: string[];
  missed_cues: string[];
}

export type ReciteMarkAction =
  | 'needs_rewrite'
  | 'archive'
  | 'unarchive'
  | 'scope_thin'
  | 'box'
  | 'snooze'
  | 'practice';

/** 三遍练习法的三步，顺序即练习顺序：看中文念英文 → 闭眼复述 → 盖住中文掐表。 */
export type PracticeStep = 'shadow' | 'blind' | 'timed';
