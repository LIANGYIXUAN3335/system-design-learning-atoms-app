// 念稿练习的 AI 判官 —— app/ai.py::review_take 的逐字移植（M4 §3.4）。
// 输入是**她自己**的录音转写，输出是一张评分卡，永远不会被打到任何表单上。
//
// 三条方法论（和 ai.py 上半部分共享）：
//   ① 能确定性算的别问模型 —— coverage 由代码算（判官只吐 missed_cues）、forbid 由正则判、
//      verbatim_ratio 由 4-gram 算、时长由词时间戳算。判官只判它唯一有优势的那四维。
//   ② 反空洞夸奖三层 —— prompt 硬规则 → _reject_review() 正则后置 → 5 分必须带 TRANSCRIPT
//      逐字引证否则代码降到 3。
//   ③ 失败不阻断 —— 判官挂了返回一张空卡，take 照样入库、录音照样在 GCS 上。
//
// DEVIATION: 不搬 `_lessons()`（那是 jobscan autofill 的答案质检回注，M4 §2 的替换清单）。

import { pyRound } from './recite.mjs';

// system prompt 与 ai.py::_RECITE_SYSTEM 逐字节相同（由 ast.literal_eval 导出，不是手抄）。
export const RECITE_SYSTEM = "You are a senior FAANG interviewer debriefing ONE spoken answer from a mock-interview drill. The candidate recorded herself answering from memory. You get the TRANSCRIPT of what she actually said, the cue points she was aiming at, and — for reference only — the TARGET SCRIPT she once wrote.\n\nReturn ONLY a JSON object:\n{\"scores\": {\"structure\": 1-5, \"concision\": 1-5, \"fluency\": 1-5, \"why_depth\": 1-5},\n \"missed_cues\": [\"<verbatim text of each cue point whose IDEA never reached the listener>\"],\n \"evidence\": {\"structure\": \"...\", \"concision\": \"...\", \"fluency\": \"...\", \"why_depth\": \"...\"},\n \"issues\": [\"<concrete problem>\", ...],\n \"fix_next\": \"<ONE executable instruction for the very next take>\",\n \"one_line\": \"这一段会让面试官写下 ___，因为 ___\"}\n\nSCORE ANCHORS — use these exact behaviours, do not invent your own scale.\n structure  1: after the whole answer a listener still doesn't know what story this was, or the\n               conclusion never arrives. 3: the conclusion only shows up in the last 20 seconds,\n               everything before it is background. 5: the landing point is in the first two\n               sentences and everything after it is evidence for that point.\n concision  1: most sentences run past 25 words, stacked clauses, restarts mid-sentence.\n               3: one or two clearly over-long sentences, the rest are listenable.\n               5: one idea per sentence, longest sentence under 16 words, not a single restart.\n fluency    1: speaking rate is 25+ wpm outside the 130-160 band, or 4+ pauses over 2 seconds.\n               3: rate at the edge of the band, ~3 long pauses, audibly rushing or dragging.\n               5: 130-160 wpm, at most one pause over 2 seconds, even rhythm.\n            This is the ONLY place in the whole system that watches her speaking rate. Do not\n            widen this band and do not excuse a rushed take because \"the other gates passed\".\n            Rushing is her documented failure mode.\n why_depth  1: reports only what she did, zero reasoning. 3: gives a reason but no trade-off\n               (says \"better\" without saying what it cost). 5: reason + an explicit trade-off +\n               she can name the option she ruled out.\n\nCOVERAGE — you do NOT score this dimension. You only output `missed_cues`.\n  A cue point counts as COVERED if the IDEA reached the listener, in ANY wording.\n  Different words are NOT a deduction — they are evidence she owns the idea. If her phrasing\n  for a cue is BETTER than the target script's, say so in `evidence`.\n  Reproducing the TARGET SCRIPT's wording earns NOTHING extra.\n  A cue is MISSED only if a listener would not have received that idea at all.\n  Copy the cue's text VERBATIM into `missed_cues` — the code matches on it.\n\nDELIVERY NOTES — the cue list may be followed by delivery instructions (how to speak, not what\n  to say). Judge those under `structure` and mention them in `evidence.structure`. They are NOT\n  cue points and must never appear in `missed_cues`.\n\nNever justify a score by comparing to the TARGET SCRIPT. The script is one way to say it, not\nthe standard. Judge the transcript as an interviewer who has never seen the script would.\n\n`read_aloud` is NOT a flag you emit. Whether she was looking at the script is already known\ndeterministically. Do not infer it from the text.\n\nBANNED — the review is worthless if it flatters:\n- Never open with praise. No \"great job\", \"nice work\", \"strong answer\", \"you did well\",\n  \"overall this is solid\". No emoji.\n- `issues` must never be empty. If the answer is genuinely good, name the thing that would\n  still stop it from being a Strong Hire.\n- `fix_next` must be ONE thing she can do in the next 60 seconds, with a location in the answer\n  (\"at the 40-second mark, go straight into…\"). Not \"be more concise\", not \"practice more\",\n  not two instructions joined by \"and also\".\n- Any dimension you score 5 MUST quote the exact words from the TRANSCRIPT that earned it in\n  `evidence`. A 5 without a verbatim quote will be reduced to 3 by the caller.\n- `one_line` must follow the shape \"这一段会让面试官写下 ___，因为 ___\" and the second half must\n  contain a concrete noun or number from THIS take.\n\nWrite `issues`, `fix_next` and `one_line` in Chinese (her working language); keep quoted English\nfrom the transcript in English.\n";

// 正则后置：模型反复不听的软约束写成无模型断言。命中 → 这一维/这条输出被判无效，代码兜底。
const _PRAISE = /great job|nice work|well done|excellent|strong answer|solid answer|good job|overall.{0,20}(good|solid|strong)|做得很好|很棒|非常好|表现不错|整体不错/i;
const _VAGUE_FIX = /^(be |try |practice|keep |continue|more |少一点|多练|注意一下|再简洁|更简洁|更清晰)/i;
const _QUOTED = /["\u201c'\u2018][^"\u201d'\u2019]{8,}["\u201d'\u2019]/;

/** Python 的 f"{x:.0f}"。 */
function f0(x) {
  return String(pyRound(Number(x) || 0, 0));
}

/** Python 打印浮点时永远带小数点（round(x, n) 的结果是 float）。 */
function pf(x) {
  const v = Number(x) || 0;
  return Number.isInteger(v) ? `${v}.0` : String(v);
}

/** ai.py::_extract_json 的逐行移植。 */
export function extractJson(text) {
  let t = String(text || '').trim();
  if (t.startsWith('```')) t = t.trim().replace(/^```(?:json)?|```$/g, '').trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  return a !== -1 && b !== -1 ? t.slice(a, b + 1) : '{}';
}

/** 判官输出的确定性质检。返回被改写的项，调用方记进 judge_raw 以便事后看判官漂移。 */
export function rejectReview(d) {
  const fixed = [];
  if (_PRAISE.test(JSON.stringify(d))) fixed.push('praise');
  if (!(d.issues || []).length) {
    d.issues = ['判官没给出问题 —— 这条本身就是问题，人看一眼'];
    fixed.push('empty_issues');
  }
  const fx = String(d.fix_next || '').trim();
  if (!fx || _VAGUE_FIX.test(fx) || fx.toLowerCase().includes(' and also ') || fx.includes('并且')) {
    fixed.push('vague_fix');
  }
  // 5 分必须带 TRANSCRIPT 逐字引证，否则降到 3。
  const ev = d.evidence || {};
  for (const [dim, raw] of Object.entries(d.scores || {})) {
    const v = Number(raw);
    if (raw === null || raw === undefined || raw === '' || !Number.isFinite(v)) continue;
    if (v >= 5 && !_QUOTED.test(String(ev[dim] || ''))) {
      d.scores[dim] = 3;
      fixed.push(`unquoted_5:${dim}`);
    }
  }
  return fixed;
}

/** ai.py::review_take 的 user prompt 组装（逐段同序，文本逐字）。 */
export function buildUserPrompt(ctx) {
  const cues = ctx.scored_cues || [];
  const cue_block = cues.map((c) => `  - ${c}`).join('\n') || '  (no cue points)';
  const notes = ctx.delivery_notes || [];
  const note_block = notes.map((n) => `  - ${n}`).join('\n');

  const parts = [
    `Question as asked this time:\n  ${ctx.question || ''}`,
    `\nCUE POINTS she was aiming at (the ONLY things \`missed_cues\` may contain):\n${cue_block}`,
  ];
  if (note_block) {
    parts.push(`\nDELIVERY NOTES (judge under structure, never in missed_cues):\n${note_block}`);
  }
  parts.push(`\nTARGET SCRIPT (reference only — never the standard):\n"""\n${String(ctx.script || '').slice(0, 4000)}\n"""`);
  parts.push(`\nTRANSCRIPT of what she actually said:\n"""\n${String(ctx.transcript || '').slice(0, 6000)}\n"""`);
  const m = ctx.metrics || {};
  parts.push(
    `\nMeasured (deterministic, already computed — do not recompute):\n`
    + `  duration ${f0(m.duration || 0)}s against a ${ctx.target_sec || 0}s target\n`
    + `  speaking rate ${pf(ctx.wpm || 0)} wpm · pauses over 2s: ${m.pauses_over_2s || 0}`
    + ` · longest pause ${pf(m.longest_pause_sec || 0)}s`);

  const vt = ctx.variant_type || 'original';
  if (vt !== 'original') {
    parts.push(
      `\nVARIANT — this take was recorded under a variant constraint:\n`
      + `  ${ctx.variant_hint || ctx.question || ''}\n`
      + `  Time allowed: ${ctx.variant_sec}s (the original target was ${ctx.target_sec}s).\n`
      + '  Judge `structure` and coverage AGAINST THE VARIANT, not against the original '
      + 'question or the original target length. Answering the original question when a '
      + 'different one was asked is a structure failure, not a coverage success. Dropping '
      + 'whole beats to fit a shorter budget is the CORRECT strategy under a time '
      + 'constraint — say which beats she chose to drop, and whether that was the right '
      + 'call, but do not score it as a failure of concision.');
  }

  const why = String(ctx.why_line || '').trim();
  if (why) {
    parts.push(
      `\nWHY LINE — before unlocking anything, she typed one line answering `
      + `"${ctx.why_q || 'why was this the right call'}":\n  """${why}"""\n`
      + '  Score `why_depth` PRIMARILY on this line, plus any reasoning she volunteered in '
      + 'the TRANSCRIPT. Do not hunt for it inside the spoken answer.');
  }

  // duration < 0.5 * target 的零代码补丁：undertime 移出硬门之后唯一的真实漏洞是
  // 「点名而不支撑」—— 30 秒里把四个要点各说一个词，coverage 机械地满分。
  const tgt = Number(ctx.target_sec || 0);
  const dur = Number(m.duration || 0);
  if (tgt && dur && dur < 0.5 * tgt) {
    parts.push(
      `\nThis take ran ${f0(dur)}s against a ${f0(tgt)}s target. Under half the target, a `
      + 'cue that was merely NAMED does not count as covered; the idea must have been '
      + 'SUPPORTED. Re-check missed_cues under that stricter reading.');
  }

  // `pace: "deliberate"` 的条目，慢是设计意图不是缺陷。band 本身不放宽（它是全系统唯一的
  // 语速监控），只在这一类条目上说明设计意图。
  if ((ctx.pace || '') === 'deliberate') {
    parts.push(
      '\nPACE — this script is deliberately slow: it is a short answer that carries its '
      + 'weight through pauses, and the author fixed its target length by hand rather than '
      + 'deriving it from the word count. For `fluency`, judge whether the pauses land '
      + 'where the meaning breaks and whether the rhythm is even — do NOT deduct for a '
      + 'speaking rate below the 130-160 band on this item alone.');
  }

  const name = String(ctx.speaker_name || '').trim();
  if (name) parts.push(`\nIn this interview the interviewer called her ${name}.`);

  return parts.join('\n');
}

const BLANK = () => ({
  scores: {}, missed_cues: [], evidence: {}, issues: [],
  fix_next: '', one_line: '', raw: '', fixed: [], error: '',
});

export class AnthropicJudge {
  constructor({ apiKey, model = 'claude-opus-4-8', effort = 'high', client = null } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.effort = effort;
    this._client = client;
  }

  async client() {
    if (!this._client) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      this._client = new Anthropic({ apiKey: this.apiKey });
    }
    return this._client;
  }

  async _ask(user, max_tokens, think) {
    const client = await this.client();
    const resp = await client.messages.create({
      model: this.model,
      max_tokens,
      output_config: { effort: this.effort },
      system: RECITE_SYSTEM,
      messages: [{ role: 'user', content: user }],
      ...(think ? { thinking: { type: 'adaptive' } } : {}),
    });
    return resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  }

  /** 给一次 take 打分。永不抛。 */
  async reviewTake(ctx) {
    const blank = BLANK();
    if (!this.apiKey) {
      blank.error = 'ai disabled or no api key';
      return blank;
    }
    const user = buildUserPrompt(ctx);
    // max_tokens 要装下 thinking + JSON。窄了会被 thinking 吃光、返回零个 text block ——
    // 那正好是判官"没给分但也没报错"的样子，最难查的一种失败。宽一点，拿不到文本时退一次
    // 「不 thinking」再试，别让一条稿因为长而永远评不出分。
    let text = '';
    let d;
    try {
      text = await this._ask(user, 8000, true);
      if (!text.trim()) text = await this._ask(user, 3000, false);
      d = JSON.parse(extractJson(text));
    } catch (e) {
      blank.error = `${(e && e.constructor && e.constructor.name) || 'Error'}: ${(e && e.message) || e}`.slice(0, 300);
      blank.raw = text.slice(0, 2000);
      return blank;
    }
    if (!Object.keys(d.scores || {}).length) {
      blank.error = '判官没返回 scores';
      blank.raw = text.slice(0, 2000);
      return blank;
    }
    d.scores = d.scores || {};
    d.missed_cues = d.missed_cues || [];
    d.evidence = d.evidence || {};
    d.issues = d.issues || [];
    const fixed = rejectReview(d);
    return {
      scores: { ...(d.scores || {}) },
      missed_cues: (d.missed_cues || []).map(String),
      evidence: d.evidence || {},
      issues: (d.issues || []).map(String),
      fix_next: String(d.fix_next || '').trim(),
      one_line: String(d.one_line || '').trim(),
      raw: text.slice(0, 8000),
      fixed,
      error: '',
    };
  }
}

/** 测试/离线用的桩。只在 RECITE_STUB_JUDGE=1 时被选中，生产路径永远走不到。 */
export class StubJudge {
  constructor(canned) {
    this.canned = canned;
  }

  async reviewTake() {
    return this.canned || {
      scores: { structure: 4, concision: 4, fluency: 4, why_depth: 4 },
      missed_cues: [],
      evidence: { structure: 'stub', concision: 'stub', fluency: 'stub', why_depth: 'stub' },
      issues: ['stub issue'],
      fix_next: '在 40 秒处直接进落点',
      one_line: '这一段会让面试官写下 owns the state model，因为 30% invalid submissions',
      raw: '',
      fixed: [],
      error: '',
    };
  }
}

export function makeJudge(env = process.env) {
  if (env.RECITE_STUB_JUDGE === '1') return new StubJudge();
  return new AnthropicJudge({
    apiKey: env.ANTHROPIC_API_KEY || '',
    model: env.RECITE_JUDGE_MODEL || 'claude-opus-4-8',
    effort: env.RECITE_JUDGE_EFFORT || 'high',
  });
}
