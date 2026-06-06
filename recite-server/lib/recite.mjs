// 念稿练习 (recite) — 领域层：队列、判定门、派生指标。
// app/recite.py 的逐函数移植（M4 §3.4）。常数一个不改。
//
// 三条贯穿全文件的设计约束（改之前先读，它们各自是一次被数据推翻的产物）：
//
// 1. **硬门里没有任何一个量依赖录音条件。** wpm 和 speaking_ratio 都退出了闸门位（裁决④：
//    实测 208 条稿里 `wpm >= 125` 会 fail 掉 60% 的理想 take，而 `wpm <= 170` 触发 0 次 —— 这个
//    量装反了方向）。语速现在**只**由 fluency 软分的行为锚点监控，那是全系统唯一看语速的地方，
//    不得以"别处已经管了"为由放宽（面试专家 v3 §一，写进 spec §7 不要再动）。
//
// 2. **她看见的东西 == 她被评分的东西。** 录前左栏是 `content` 型要点卡，coverage 的分母也只有
//    `content` + `canon`（裁决⑥/⑦）。v2 让她对着中文 gloss 说、按 key_points 评分，那是练习目标
//    最不该有的错位。
//
// 3. **压缩档（constraint/truncate/transfer）的失败不降箱。** 它是拉伸练习不是保持测量；Leitner
//    的降箱语义是"你忘了"，而压缩档失败的含义是"你还没练到能在 53 秒里讲完"（MEM3-P1-2）。
//    不改这一条的话 box 2/3 会震荡，归档在概率上不可达 —— 和裁决⑤ 刚修好的是同一个 bug。
//
// 这个模块只做确定性的事，没有任何 I/O —— 需要读写状态的函数（apply_outcome / today_queue /
// calibrating_now / histogram / prev_transcript）都接一个注入的 `store`。

// ---------------------------------------------------------------- 常数与配置

export const BOX_DAYS = [1, 2, 3, 5, 8];
export const TARGET_WPM = 120;
export const VARIANT_TYPES = ['original', 'paraphrase', 'constraint', 'truncate', 'transfer'];
// 施加了物理约束（更短的时间）的档。这几档：时长门 1.05×、覆盖门 3、r 不成旗、fail 不降箱。
export const CONSTRAINED = ['constraint', 'truncate', 'transfer'];
export const VERDICTS = [[4.5, 'Strong Hire'], [4.0, 'Hire'], [3.4, 'Lean'], [0.0, 'No Hire']];

export const _DEFAULTS = {
  pass_total: 3.6,
  pass_streak: 2,
  daily_cap: 6,
  new_cap: 2,
  review_cap: 4,
  per_interview_cap: 2,
  session_minutes: 25,
  horizon_days: 20,
  calibrating: true,
  calibrate_takes: 20,
  calibrate_days: 3,
  r_flag_threshold: 0.6,
  r_soft_until_takes: 20,
  overdue_cap_days: 7,
  fail_streak_rewrite: 3,
  snooze_days: 3,
};
// DEVIATION: tts_voice / tts_rate 不搬 —— 范读 TTS 不进 Atoms 的 UI（M4 §0 决定 3）。

export function cfg_recite(cfg) {
  return { ..._DEFAULTS, ...((cfg && cfg.recite) || {}) };
}

// ---------------------------------------------------------------- Python 语义补丁

/** Python 的 round()：half-to-even。JS 的 Math.round 是 half-up，两者在 .5 上不同。 */
export function pyRound(x, nd = 0) {
  if (!Number.isFinite(x)) return 0;
  const m = 10 ** nd;
  const y = x * m;
  const f = Math.floor(y);
  const diff = y - f;
  let r;
  if (Math.abs(diff - 0.5) < 1e-9) r = f % 2 === 0 ? f : f + 1;
  else r = Math.round(y);
  return r / m;
}

/** Python 的 f"{x:.0f}"（同样 half-to-even）。 */
function fmt0(x) {
  return String(pyRound(Number(x) || 0, 0));
}

// ---------------------------------------------------------------- key_points 四类分型

// form = 交付指令（说话方式），不是内容拍子。不进 coverage 分母，只喂判官的 structure 段。
const _FORM_RX = /删掉|不要|不用|不许|禁止|别说|别用|别再|每句|吸气|主语|开场|换成|保留|说完|改成|节奏|语速|停顿|句子.{0,4}(短|长|拆)|拆成|先说|一句话说|中途|改口|重起|眼神|语气/;
// forbid = 她真的说过并因此失分的原话。
const _FORBID_RX = /不许说|绝不能说|一个字都不要|禁止说出|千万别说|不要再说|不能出现/;
// canon = 必须逐字命中的口径。进 coverage，但从 r 的分母剔除。
const _CANON_RX = /CANON|口径|🔴|逐字|原话不动|按原文/;
// 撰稿注记：给复盘作者看的，不是给她看的。直接丢弃。
const _NOTE_RX = /\.md\b|§|复盘|见上文|见下文|待确认|TODO/;

const _NUM_RX = /\d/;
const _CAUSAL_RX = /因为|所以|导致|换来|代价|取舍|权衡|不是.{0,8}而是|⇒|→|才|否则/;

/** 从一条要点里抠出被引号包住的英文原句 —— forbid 型的 probe。 */
function _quoted(s) {
  const m = /["“'‘「『]([A-Za-z][^"”'’」』]{6,120})["”'’」』]/.exec(s);
  return m ? m[1].trim() : '';
}

/** 裸字符串 / 已分型对象 → {t, text, probe}。存量兼容用确定性前缀推断。 */
export function classify_key_point(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const t = String(raw.t || '').trim().toLowerCase();
    if (['content', 'form', 'forbid', 'canon'].includes(t)) {
      return { t, text: String(raw.text || '').trim(), probe: String(raw.probe || '').trim() };
    }
    raw = String(raw.text || '');
  }
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return { t: 'drop', text: '', probe: '' };
  // canon 先判：含 CANON 的句子往往也含"不要"，顺序反了会被 form 吃掉
  if (_CANON_RX.test(s)) return { t: 'canon', text: s, probe: _quoted(s) };
  if (_FORBID_RX.test(s)) return { t: 'forbid', text: s, probe: _quoted(s) };
  if (_NOTE_RX.test(s)) return { t: 'drop', text: s, probe: '' };
  if (_FORM_RX.test(s)) return { t: 'form', text: s, probe: '' };
  return { t: 'content', text: s, probe: '' };
}

export function parse_key_points(raw) {
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = [raw];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw.map(classify_key_point).filter((k) => k.t !== 'drop' && k.text);
}

/**
 * coverage 的分母（≤4 条）+ 被截掉的加分项 → [scored, extra]。
 *
 * 截取顺序显式定义为 canon 优先 → 含数字/因果词的 → 其余；被截掉的仍显示在左栏（灰色，标
 * 「加分项」），只是不进分母。保住 Cowan ~4 的工作记忆约束，又不让内容凭数组序消失。
 */
export function scored_cues(points) {
  const pool = points.filter((k) => k.t === 'content' || k.t === 'canon');
  const rank = (k) => {
    if (k.t === 'canon') return 0;
    if (_NUM_RX.test(k.text) || _CAUSAL_RX.test(k.text)) return 1;
    return 2;
  };
  // Python 的 `pool.index(k)` 取的是第一个**相等**元素的下标（dict 按值比较），不是身份下标。
  const same = (a, b) => a.t === b.t && a.text === b.text && a.probe === b.probe;
  const keyed = pool.map((k) => ({ k, r: rank(k), i: pool.findIndex((x) => same(x, k)) }));
  keyed.sort((a, b) => a.r - b.r || a.i - b.i); // Array#sort 自 ES2019 起稳定
  const ordered = keyed.map((x) => x.k);
  return [ordered.slice(0, 4), ordered.slice(4)];
}

/** coverage 由代码算，判官只输出 missed_cues。它是唯一事实性维度（说没说到）。 */
export function coverage_score(scored, missed) {
  const n = scored.length;
  if (n === 0) return 3;
  const hit = Math.max(0, n - missed.filter((m) => m).length);
  const frac = hit / n;
  if (hit === n) return 5;
  return frac >= 0.8 ? 4 : frac >= 0.6 ? 3 : frac >= 0.4 ? 2 : 1;
}

// ---------------------------------------------------------------- 派生指标

const _WORD_RX = /[A-Za-z0-9']+/g;
const _CANON_SPAN_RX = () => /«([^»]*)»/g;

export function words(text) {
  return String(text || '').toLowerCase().match(_WORD_RX) || [];
}

/** R1：target_sec 不再手估，由词数导出，取 5 秒的整数倍。120 是**墙钟**语速。 */
export function target_sec_from_words(n_words) {
  if (n_words <= 0) return 45;
  return Math.max(20, Math.trunc(pyRound((n_words / TARGET_WPM) * 60 / 5)) * 5);
}

/** 把 «…» 标注的逐字跨度从 script 里剥掉 —— 它们本来就该一样，不该进 r 的分母。 */
export function strip_canon(script) {
  return String(script || '').replace(_CANON_SPAN_RX(), ' ');
}

export function canon_spans(script) {
  return [...String(script || '').matchAll(_CANON_SPAN_RX())]
    .map((m) => m[1].trim())
    .filter(Boolean);
}

function _ngrams(ws, n = 4) {
  const out = new Set();
  if (ws.length < n) return out;
  for (let i = 0; i <= ws.length - n; i++) out.add(ws.slice(i, i + n).join(' '));
  return out;
}

/**
 * r = |4g(她说的) ∩ 4g(稿)| / |4g(她说的)|，逐字跨度已从稿里剥离。
 *
 * r 单独测不出内化和背诵的区别（两者都让 r 上升）。判别量是 r 与 r_prev 的联合走势。
 */
export function verbatim_ratio(transcript, script) {
  const t = _ngrams(words(transcript));
  if (t.size === 0) return 0.0;
  const s = _ngrams(words(strip_canon(script)));
  let hit = 0;
  for (const g of t) if (s.has(g)) hit++;
  return pyRound(hit / t.size, 4);
}

/** 转写词数 / 发声分钟。**只喂 fluency 软分**，硬门里没有任何东西看它。 */
export function wpm(transcript, metrics) {
  const spk = Number(metrics.speaking_sec || 0) || Number(metrics.duration || 0);
  if (spk <= 0) return 0.0;
  return pyRound(words(transcript).length / (spk / 60.0), 1);
}

const _HARD_FILLER = /\b(um|uh|erm)\b/gi;
const _SOFT_FILLER = /\b(like|you know|kind of|sort of|basically|actually)\b/gi;

/** UI 标"参考值"，不进 pass 判定 —— ASR 会清洗 disfluency，这个数系统性偏低。 */
export function filler_counts(transcript) {
  const t = String(transcript || '');
  return {
    hard_filler: (t.match(_HARD_FILLER) || []).length,
    soft_filler: (t.match(_SOFT_FILLER) || []).length,
  };
}

// ---------------------------------------------------------------- 变体

/** 第 2 次起按 n_takes 轮换。返回 {type, q, sec, hint}。 */
export function variant_for(item, n_takes) {
  let vs = item.variants;
  if (typeof vs === 'string') {
    try {
      vs = JSON.parse(vs);
    } catch {
      vs = [];
    }
  }
  vs = (vs || []).filter((v) => v && typeof v === 'object' && !Array.isArray(v));
  const base = {
    type: 'original',
    q: item.question || '',
    sec: parseInt(item.target_sec || 60, 10) || 60,
    hint: '',
  };
  if (!vs.length || n_takes <= 0) return base;
  const pool = [base, ...vs];
  return pool[n_takes % pool.length];
}

/**
 * 时长门 / 覆盖门 / r 是否成旗 —— 全部由变体分型驱动。
 *
 * FEY-A4 的两半必须成对：1.05 × variant_sec（不是 1.4×），覆盖门同时松到 3。
 */
export function gates(cfg_r, variant_type, variant_sec, target_sec, calibrating, n_paraphrase_takes) {
  if (CONSTRAINED.includes(variant_type)) {
    const sec = Math.max(10, parseInt(variant_sec, 10) || Math.trunc(pyRound(0.7 * target_sec)));
    return {
      dur_gate: pyRound(1.05 * sec, 1),
      coverage_gate: 3,
      r_is_flag: false,
      demotes_on_fail: false,
      sec,
    };
  }
  const hard_r =
    variant_type === 'paraphrase' &&
    !calibrating &&
    n_paraphrase_takes >= parseInt(cfg_r.r_soft_until_takes, 10);
  return {
    dur_gate: pyRound(1.4 * target_sec, 1),
    coverage_gate: 4,
    r_is_flag: hard_r,
    demotes_on_fail: true,
    sec: target_sec,
  };
}

// ---------------------------------------------------------------- 判定

export function verdict_word(total) {
  for (const [lo, w] of VERDICTS) if (total >= lo) return w;
  return 'No Hire';
}

/** 确定性正则红旗。probe 是她真的说过、并因此失分的英文原句。 */
export function forbid_hits(transcript, points) {
  const t = words(transcript).join(' ');
  const out = [];
  for (const k of points) {
    if (k.t !== 'forbid' || !k.probe) continue;
    const p = words(k.probe).join(' ');
    if (p && t.includes(p)) out.push(k.probe);
  }
  return out;
}

/**
 * 把确定性指标 + LLM 判官输出合成一次裁定。
 *
 * 硬门四条全部与录音条件无关、可复算、可审计。软分是 LLM 的四维均值（coverage 由代码算，
 * 但它进均值 —— 它是分数里唯一有事实基础的那一维）。
 */
export function judge_take({
  cfg_r, item, points, scored, transcript, metrics, review, why_line,
  variant_type, variant_sec, mode, first_exposure, box, calibrating, r,
  n_paraphrase_takes, number_flags,
}) {
  const target_sec = parseInt(item.target_sec || 60, 10) || 60;
  const g = gates(cfg_r, variant_type, variant_sec, target_sec, calibrating, n_paraphrase_takes);
  const missed = (review.missed_cues || []).map((m) => String(m)).filter((m) => m.trim());
  const cov = coverage_score(scored, missed);

  const duration = Number(metrics.duration || 0);
  const fb = forbid_hits(transcript, points);
  const reciting = Boolean(g.r_is_flag && r > Number(cfg_r.r_flag_threshold));

  const hard_flags = [];
  if (fb.length && !calibrating) hard_flags.push(`说了不该说的：${fb[0]}`);
  if (reciting) hard_flags.push('reciting_under_variant');
  // 口径检查独立成条、不进分数；只有硬档（banned_phrases）才进硬门。
  if (!calibrating) hard_flags.push(...number_flags.filter((f) => f.startsWith('banned:')));

  const why_submitted = Boolean(String(why_line || '').trim());
  const soft = review.scores || {};
  const dims = [];
  for (const d of ['structure', 'concision', 'fluency', 'why_depth']) {
    const v = Number(soft[d]);
    if (soft[d] !== undefined && soft[d] !== null && Number.isFinite(v)) dims.push(v);
  }
  // 判官挂了不能变成"过了"。coverage 是代码算的、永远有值，用它单独当均值会让一次
  // ASR/LLM 故障静默地记成一次 pass —— 那比不给分更糟。
  const judged = dims.length > 0;
  const llm_mean = judged
    ? pyRound((dims.reduce((a, b) => a + b, 0) + cov) / (dims.length + 1), 2)
    : Number(cov);

  const hard_ok = cov >= g.coverage_gate && duration <= g.dur_gate && why_submitted && !hard_flags.length;
  const why_depth = Number(soft.why_depth || 0);
  const soft_ok = judged && llm_mean >= Number(cfg_r.pass_total) && (box < 3 || why_depth >= 4);
  const passed = Boolean(hard_ok && soft_ok && mode === 'recall' && !first_exposure);

  const notes = [];
  if (!judged) notes.push('评分没跑出来，录音已存 —— 这一次不计过关');
  if (cov < g.coverage_gate) notes.push(`覆盖 ${cov} < ${g.coverage_gate}`);
  if (duration > g.dur_gate) notes.push(`${fmt0(duration)}s > 上限 ${fmt0(g.dur_gate)}s`);
  if (!why_submitted) notes.push('没写 why');
  notes.push(...hard_flags);
  // undertime 不是失败（裁决③）：35 秒说完且要点全中是一次好回答。
  if (duration && duration < 0.7 * g.sec && cov >= g.coverage_gate) {
    notes.push(`${fmt0(duration)}s / 目标 ${g.sec}s — 要点全中，这个长度可以`);
  }

  return {
    coverage: cov,
    total: llm_mean,
    verdict: verdict_word(llm_mean),
    hard_ok: hard_ok ? 1 : 0,
    passed: passed ? 1 : 0,
    gate_note: notes.join(' · '),
    dur_gate: g.dur_gate,
    coverage_gate: g.coverage_gate,
    r_is_flag: g.r_is_flag,
    demotes_on_fail: g.demotes_on_fail,
    red_flags: hard_flags,
    forbid_hits: fb,
    missed_cues: missed,
  };
}

// ---------------------------------------------------------------- 排程

export function scaled_day(box, horizon_days) {
  const cap = Math.max(1, Math.trunc(horizon_days * 0.25 + 0.5));
  const idx = Math.max(0, Math.min(BOX_DAYS.length - 1, parseInt(box, 10) - 1));
  return Math.min(BOX_DAYS[idx], cap);
}

const _LA_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric', month: '2-digit', day: '2-digit',
});
const _LA_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Los_Angeles',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

/** store.la_today() 的等价物：America/Los_Angeles 的日期。 */
export function today(now = new Date()) {
  return _LA_DATE.format(now);
}

/** store.la_now_iso() 的等价物：LA 本地时间 + 偏移，秒精度。 */
export function now_iso(now = new Date()) {
  const d = today(now);
  const t = _LA_TIME.format(now).replace(/^24:/, '00:');
  // 偏移由 UTC 与 LA 墙钟之差反推（-07:00 夏令时 / -08:00 冬令时）。
  const asUtc = Date.parse(`${d}T${t}Z`);
  const offMin = Math.round((asUtc - Math.floor(now.getTime() / 1000) * 1000) / 60000);
  const sign = offMin < 0 ? '-' : '+';
  const a = Math.abs(offMin);
  const hh = String(Math.floor(a / 60)).padStart(2, '0');
  const mm = String(a % 60).padStart(2, '0');
  return `${d}T${t}${sign}${hh}:${mm}`;
}

export function plus(days, from = today()) {
  const [y, m, d] = from.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + Math.max(0, Math.trunc(days)));
  return dt.toISOString().slice(0, 10);
}

/** plus() 的负向版本（overdue 地板用 `_plus(-N)`，Python 里 max(0,...) 之前先取负）。 */
export function shift(days, from = today()) {
  const [y, m, d] = from.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + Math.trunc(days));
  return dt.toISOString().slice(0, 10);
}

export const DEFAULT_STATE = {
  box: 1, due_on: null, n_takes: 0, n_pass: 0, streak: 0, last_fail: 0,
  best_total: null, last_total: null, last_fix: '', last_at: null,
  needs_rewrite: 0, snooze_until: null, archived: 0,
  exposed: 0, exposure_stage: 0, exposure_at: null, scope_override: null,
  // 三遍练习法追踪（2026-09-22）：跟读/闭眼/掐表 各存打勾时刻，null=没勾。
  practice_shadow_at: null, practice_blind_at: null, practice_timed_at: null,
};

/** mark practice 认的三步。顺序即练习顺序：看中文念英文 → 闭眼复述 → 盖住中文掐表。 */
export const PRACTICE_STEPS = ['shadow', 'blind', 'timed'];

export function default_state(item_id, day = today()) {
  return { ...DEFAULT_STATE, item_id, due_on: day };
}

/**
 * 晋箱 / 降箱 / due。写 state，返回新状态。
 *
 * 压缩档 fail 不降箱（demotes_on_fail=false）：它是拉伸练习不是保持测量。这完整保留了
 * FEY-A4 想要的那个逼迫（她拿不到 pass，晋不了箱），只是不把她往回推。
 */
export async function apply_outcome(store, cfg_r, item_id, {
  passed, first_exposure, variant_type, same_day, hard_red, demotes_on_fail, total, fix_next,
}) {
  // Python 的 get_state 缺行时就地插一条默认；这里等价地取默认值。
  const st = (await store.getState(item_id)) || default_state(item_id);
  let box = parseInt(st.box || 1, 10);
  let streak = parseInt(st.streak || 0, 10);
  const calibrating = Boolean(cfg_r.calibrating);
  const horizon = parseInt(cfg_r.horizon_days, 10);

  let due;
  let n_pass;
  let last_fail;
  if (first_exposure) {
    // 曝光轮的基线 take：不 pass、不 reset box、不进 streak，只写基线分，due = 明天。
    due = plus(1);
    n_pass = parseInt(st.n_pass || 0, 10);
    last_fail = parseInt(st.last_fail || 0, 10);
  } else if (passed) {
    n_pass = parseInt(st.n_pass || 0, 10) + 1;
    last_fail = 0;
    if (!same_day) {
      streak += 1;
      const recent = (await store.listTakes(item_id, 2, { where: { passed: 1 } }))
        .map((r) => r.variant_type);
      if (streak >= parseInt(cfg_r.pass_streak, 10)
          && recent.some((v) => (v || 'original') !== 'original')) {
        box += 1;
        streak = 0;
      }
    }
    due = plus(scaled_day(box, horizon));
  } else {
    n_pass = parseInt(st.n_pass || 0, 10);
    streak = 0;
    last_fail = 1;
    if (!calibrating && demotes_on_fail) {
      box = (parseInt(st.last_fail || 0, 10) || hard_red) ? 1 : Math.max(1, box - 1);
    }
    due = plus(1);
  }

  const n_takes = parseInt(st.n_takes || 0, 10) + 1;
  let best = st.best_total;
  best = best === null || best === undefined ? total : Math.max(Number(best), total);
  let needs_rewrite = parseInt(st.needs_rewrite || 0, 10);
  let snooze = st.snooze_until ?? null;
  if (!passed && !first_exposure) {
    const n = parseInt(cfg_r.fail_streak_rewrite, 10);
    const recent_fail = (await store.listTakes(item_id, n, { where: { first_exposure: 0 } }))
      .map((r) => r.passed);
    if (recent_fail.length >= n && !recent_fail.some((p) => p)) {
      needs_rewrite = 1;
      snooze = plus(parseInt(cfg_r.snooze_days, 10));
      due = snooze;
      await store.appendRough(item_id, '连续 fail，稿要改');
    }
  }

  const patch = {
    box, streak, due_on: due, n_takes, n_pass, last_fail,
    best_total: best, last_total: total, last_fix: fix_next, last_at: now_iso(),
    needs_rewrite, snooze_until: snooze,
  };
  await store.setState(item_id, patch);
  return { box, streak, due_on: due, n_takes, needs_rewrite };
}

// ---------------------------------------------------------------- 队列

/**
 * 今日队列：due 的复习 + 至多 new_cap 条从未练过的，同一场面试至多 per_interview_cap 条。
 *
 * `new_cap: 2` 不是优化是必须的：没有 new/review 配额时，Day 1 她拿到 6 条全新条目 →
 * 全部首次曝光 → 全部不计过 → 全部回到明天；Day 2 再叠 6 条，两天锁死。
 *
 * items = bundle 的 ReciteItem[]（含 created_at / interview / scope / quality / deferred）；
 * states = {item_id: state}；返回 [{item, state}] 的 item 数组（和 Python 一样返回条目行）。
 */
export function today_queue(items, states, cfg, { day = today(), onReset = null } = {}) {
  const c = cfg_recite(cfg);
  const rows = [];
  for (const it of items) {
    const s = states[it.id] || {};
    if (it.deferred) continue;
    if (s.archived) continue;
    const scope = s.scope_override || it.scope || 'unknown';
    if (!['ok', 'unknown'].includes(scope)) continue;
    if ((it.quality || 'ok') !== 'ok') continue;
    if (s.snooze_until && String(s.snooze_until) > day) continue;
    rows.push({
      item_id: it.id,
      interview: it.interview || '',
      created_at: it.created_at || '',
      due_on: s.due_on ?? null,
      n_takes: s.n_takes || 0,
      item: it,
      state: s,
    });
  }
  // ORDER BY COALESCE(s.due_on, i.created_at)
  rows.sort((a, b) => {
    const ka = a.due_on || a.created_at;
    const kb = b.due_on || b.created_at;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  // overdue 封顶：欠了超过 7 天的就地重置成今天到期。
  const floor = shift(-parseInt(c.overdue_cap_days, 10), day);
  const stale = rows.filter((r) => (r.due_on || day) < floor).map((r) => r.item_id);
  if (stale.length) {
    for (const r of rows) if (stale.includes(r.item_id)) r.due_on = day;
    if (onReset) onReset(stale, day);
  }

  const due = rows.filter((r) => (r.n_takes || 0) > 0 && (r.due_on || day) <= day);
  const neu = rows.filter((r) => !(r.n_takes || 0));
  due.sort((a, b) => {
    const ka = a.due_on || day;
    const kb = b.due_on || day;
    if (ka !== kb) return ka < kb ? -1 : 1;
    return a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0;
  });

  const out = [];
  const per_iv = new Map();
  const take = (pool, limitIn) => {
    let limit = limitIn;
    for (const r of pool) {
      if (out.length >= parseInt(c.daily_cap, 10) || limit <= 0) break;
      const iv = r.interview || '';
      if ((per_iv.get(iv) || 0) >= parseInt(c.per_interview_cap, 10)) continue;
      per_iv.set(iv, (per_iv.get(iv) || 0) + 1);
      out.push(r);
      limit -= 1;
    }
  };

  take(due, parseInt(c.review_cap, 10));
  take(neu, parseInt(c.new_cap, 10));
  if (out.length < parseInt(c.daily_cap, 10)) {
    const seen = new Set(out.map((r) => r.item_id));
    take([...due, ...neu].filter((r) => !seen.has(r.item_id)), parseInt(c.daily_cap, 10) - out.length);
  }
  return out;
}

/** 前 N take 或前 M 天，先到为准。校准期 fail 不改 box。 */
export async function calibrating_now(store, cfg, { day = today() } = {}) {
  const c = cfg_recite(cfg);
  if (!c.calibrating) return false;
  const n = await store.countTakes({ first_exposure: 0 });
  if (n >= parseInt(c.calibrate_takes, 10)) return false;
  const first = await store.listTakes(null, 1, { where: { first_exposure: 0 }, order: 'asc' });
  const t0 = first.length ? String(first[0].ts || '') : '';
  if (t0) {
    const d0 = t0.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d0)) {
      const days = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${d0}T00:00:00Z`)) / 86400000);
      if (days >= parseInt(c.calibrate_days, 10)) return false;
    }
  }
  return true;
}

/**
 * 页脚校准直方图。
 *
 * 分母 first_exposure=0 AND mode='recall'：first_exposure 按定义永不 pass，把它混进分母会让
 * 第一周的过关率被系统性压低三分之一。**校准只有一次机会。**
 * 再按 variant_type 分开：原版档和压缩档是两套不同判据。
 */
export function histogram(takes) {
  const rows = takes
    .filter((r) => !r.first_exposure && (r.mode || 'recall') === 'recall'
      && r.total !== null && r.total !== undefined)
    .slice(0, 40);
  const bucket = (name, pool) => {
    if (!pool.length) return null;
    const totals = pool.map((r) => Number(r.total || 0)).sort((a, b) => a - b);
    const idx = pool.length > 1 ? Math.trunc(pool.length * 0.6) - 1 : 0;
    return {
      name,
      n: pool.length,
      pass_rate: pyRound((100 * pool.filter((r) => r.passed).length) / pool.length),
      p60: pyRound(totals[idx], 2),
    };
  };
  const orig = rows.filter((r) => ['original', 'paraphrase'].includes(r.variant_type || 'original'));
  const varr = rows.filter((r) => CONSTRAINED.includes(r.variant_type || 'original'));
  const rs = rows.slice(0, 3).reverse().map((r) => pyRound(Number(r.verbatim_ratio || 0), 2));
  return {
    buckets: [bucket('原版', orig), bucket('变体', varr)].filter(Boolean),
    r_trend: rs,
    spoken_min: pyRound(rows.reduce((a, r) => a + Number(r.dur_sec || 0), 0) / 60, 1),
  };
}

/** 上一次转写 —— r_prev 的对照物。A0 基线 take 排除（它结构性偏高）。 */
export async function prev_transcript(store, item_id, exclude_take_id = null) {
  const rows = await store.listTakes(item_id, 0, { where: { first_exposure: 0 } });
  for (const r of rows) {
    if (exclude_take_id && r.take_id === exclude_take_id) continue;
    if (r.transcript) return r.transcript;
  }
  return '';
}

// ---------------------------------------------------------------- 口径白名单

const _PCT_RX = () => /(\d{1,3})\s*(?:percent|%)/gi;

/**
 * 📋 事实核对 —— 独立成条，不进 total，不进硬门（除非 banned 硬档）。
 *
 * 措辞是「上次你说的是 30%」而不是「越界」—— 记忆锚点校准，不是一次扣分。
 */
export function fact_check(transcript, item, numbers) {
  const wl = numbers || {};
  const allowedList = wl.allowed || [];
  const allowed = new Set(allowedList.map((a) => String(a.value)));
  const out = [];
  for (const m of String(transcript || '').matchAll(_PCT_RX())) {
    const v = m[1];
    if (allowed.size && !allowed.has(v)) {
      const ref = allowedList.find((a) => String(a.story || '') === String(item.story_id || ''));
      out.push({
        kind: 'number',
        level: 'soft',
        said: `${v}%`,
        note: ref ? `上次你说的是 ${ref.value}%（${ref.canonical || ''}）` : '这个数不在口径白名单里',
        provenance: (ref || {}).provenance || '',
      });
    }
  }
  for (const bad of wl.banned_phrases || []) {
    if (bad && String(transcript || '').toLowerCase().includes(String(bad).toLowerCase())) {
      out.push({ kind: 'banned', level: 'hard', said: bad, note: '这个说法已经从口径里删掉了', provenance: '' });
    }
  }
  return out;
}

export function number_flag_strings(checks) {
  return checks.filter((c) => c.level === 'hard').map((c) => `banned:${c.said}`);
}
