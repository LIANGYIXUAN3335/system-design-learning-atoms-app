#!/usr/bin/env node
/**
 * Heuristic audit for cards that are likely not self-contained learning atoms.
 *
 * This is intentionally conservative: it does not decide correctness. It finds
 * cards worth human review for missing context, trivia-shaped number questions,
 * weak distractors, unexplained jargon, and truncated/generated explanations.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { glob } from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const limitArg = args.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : 120;
const explicitFiles = args.filter((arg) => !arg.startsWith('--'));

const TRACKS = ['system-design', 'llm-sd', 'low-level-design', 'ai-coding'];
const OPTION_NOTE_PAIRS = [
  ['optionMeanings', 'optionMeanings_en'],
  ['optionDirectness', 'optionDirectness_en'],
  ['optionScenarioImpacts', 'optionScenarioImpacts_en'],
];
const GENERIC_EXPLANATION_RE =
  /(不符合题目需求|超出了初版范围|This does not meet the stated requirements|This doesn't fit the requirements|信息不足|not enough information)/i;
const TRUNCATED_RE =
  /(因为 .*，所以$|正是\s*$|就是\s*$|from \.$|to rea$|DynamoD$|mon\.$|popul\.$|explic\.$|正是 long$|通常先从。$|dependency time\.)/i;
const CONTEXTLESS_RE =
  /^(这|这个|这种|该|上述|本设计|文中|文章里|以下哪些属于本题|这是什么意思|这个空档|这一层|这段|此处|当前方案)/;
const JARGON_RE =
  /\b(DynamoDB|Cassandra|Kafka|Flink|GraphSAGE|DLRM|GCN|GSI|LSM|SSTable|RCU|WCU|WebRTC|SSE|TCP|UDP|HTTP\/2|gRPC|IPW|inverse-propensity|counterfactual|embedding|vector|ANN|HNSW|fan-out|fanout)\b/i;

const NUMBER_RE =
  /(\d[\d,.]*\s*(万|亿|k|m|b|ms|s|秒|分钟|小时|天|年|DAU|QPS|RPS|TPS|req\/s|RCU|WCU|KB|MB|GB|TB|%|倍)|[一二三四五六七八九十百千万亿]+\s*(个|次|天|年|秒|分钟|小时))/i;
const NUMERIC_CHOICE_RE =
  /^(?:约\s*)?(?:~|≈)?\s*(\d[\d,.]*|[一二三四五六七八九十百千万亿]+)\s*(万|亿|k|m|b|ms|s|秒|分钟|小时|天|年|DAU|QPS|RPS|TPS|req\/s|RCU|WCU|KB|MB|GB|TB|%|个|次|条|行|用户|商品)?/i;
const CLOZE_RE = /\{\{([^}]+)\}\}/g;

/**
 * Length budgets (SuperMemo minimum information principle: short cards are
 * remembered; long cards are skimmed). Chars, CJK counts as 1.
 */
const BUDGET = {
  whyWarn: 120, // ~2 中文句
  whyError: 170,
  optionNoteWarn: 70, // per option field, ~1 句
  optionNoteError: 110,
  whenOtherWins: 140,
  revealTotalWarn: 420, // why + whenOtherWins + all option notes a user reads per reveal
};

/** zero-information filler the runtime/enrich templates tend to emit */
const TEMPLATE_FILLER_RE =
  /(代表一种可以拿来比较的判断路径|意味着你认为当前比较维度上|把概念边界划到|这道题里的(候选方案|对比对象|概念判断)|一种可以.*的(思路|路径)而已|选择它会把(排查|方案|设计|解释|问题)?.{0,18}带向|把排查带向|直接命中题目的关键约束|最直接命中|^(含义|影响|直接性)\s*\d+$|^(Meaning|Impact|Directness)\s*\d+$)/i;

/** explicit tradeoff signal: naming both sides of an axis */
const TRADEOFF_RE =
  /(vs|对比|而不是|换来|代价是|牺牲|相比|取舍|权衡|trade-?off|更快但|更慢但|一致性.{0,6}(可用|延迟)|(读|写).{0,8}(读|写).{0,4}(路径|放大|优先))/i;

/** longest common substring length ≥ n between two strings (cheap n-gram check) */
function sharesLongRun(a, b, n = 14) {
  if (!a || !b || a.length < n) return false;
  for (let i = 0; i + n <= a.length; i += 4) {
    if (b.includes(a.slice(i, i + n))) return true;
  }
  return false;
}

function compact(text) {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function allText(card) {
  return [
    card.q,
    card.q_en,
    card.scenario,
    card.scenario_en,
    card.why,
    card.why_en,
    card.whenOtherWins,
    ...(card.options ?? []),
    ...(card.optionExplanations ?? []),
    ...(card.optionExplanations_en ?? []),
  ]
    .filter(Boolean)
    .join(' ');
}

function choiceCard(card) {
  return card.format === 'mcq' || card.format === 'multi' || card.format === 'code';
}

function isMostlyNumericChoiceCard(card) {
  const options = card.options ?? [];
  if (!options.length) return false;
  const numericOptions = options.filter((option) => NUMERIC_CHOICE_RE.test(compact(option))).length;
  return numericOptions >= Math.max(2, Math.ceil(options.length * 0.6));
}

function isBareNumberChoiceCard(card) {
  return card.atomType === 'number' && isMostlyNumericChoiceCard(card);
}

function completeStringArray(card, key) {
  const n = Array.isArray(card.options) ? card.options.length : 0;
  return Array.isArray(card[key]) && card[key].length === n && card[key].every((value) => compact(value));
}

function hasCompleteRichOptionNotes(card) {
  return (
    completeStringArray(card, 'optionMeanings') &&
    completeStringArray(card, 'optionDirectness') &&
    completeStringArray(card, 'optionScenarioImpacts') &&
    completeStringArray(card, 'optionMeanings_en') &&
    completeStringArray(card, 'optionDirectness_en') &&
    completeStringArray(card, 'optionScenarioImpacts_en')
  );
}

function hasCompleteLegacyOptionNotes(card) {
  return completeStringArray(card, 'optionExplanations') && completeStringArray(card, 'optionExplanations_en');
}

function add(issues, category, severity, reason) {
  issues.push({ category, severity, reason });
}

function auditCard(card, rel) {
  const issues = [];
  const q = compact(card.q);
  const scenario = compact(card.scenario);
  const text = allText(card);
  const options = card.options ?? [];
  const optionExplanations = [...(card.optionExplanations ?? []), ...(card.optionExplanations_en ?? [])];

  if (!scenario && CONTEXTLESS_RE.test(q)) {
    add(issues, 'missing_context', 3, 'question depends on article/page context but has no scenario');
  }
  if (!compact(card.q_en)) {
    add(issues, 'missing.q_en', 1, 'question has no English helper line (q_en); bilingual drill should show it under Chinese');
  }
  if (scenario && !compact(card.scenario_en)) {
    add(issues, 'missing.scenario_en', 1, 'scenario has no English helper line (scenario_en); bilingual drill should show it under Chinese');
  }

  if (
    choiceCard(card) &&
    isMostlyNumericChoiceCard(card) &&
    /多少|多久|量级|大约|约|每天|每秒|几跳|几层|几次|几秒|几毫秒|benchmark|基准/i.test(q)
  ) {
    add(issues, 'trivia_or_bad_number_question', 3, 'mostly numeric choices; likely tests recall instead of design implication');
  }

  if (card.format === 'cloze' && /补全.*数字|填.*数字|核心.*数字/i.test(q)) {
    const blanks = [...compact(card.text).matchAll(CLOZE_RE)].map((m) => compact(m[1]));
    const numericBlanks = blanks.filter((blank) => NUMBER_RE.test(blank)).length;
    if (numericBlanks > 0) {
      add(
        issues,
        'trivia_or_bad_number_question',
        2,
        'cloze asks learners to recall raw numeric targets; put numbers in scenario and cloze the design consequence',
      );
    }
  }

  if (!scenario && card.atomType === 'number' && NUMBER_RE.test(text)) {
    add(issues, 'trivia_or_bad_number_question', 2, 'number atom has no scenario explaining why the number matters');
  }

  if (choiceCard(card)) {
    const hasRichNotes = hasCompleteRichOptionNotes(card);
    const hasLegacyNotes = hasCompleteLegacyOptionNotes(card);
    if (!isBareNumberChoiceCard(card) && !hasRichNotes && !hasLegacyNotes) {
      add(
        issues,
        'choice.missing_option_notes',
        3,
        'choice card has no complete per-option explanation set; add rich option notes or legacy optionExplanations in both languages unless it is a bare numeric estimate',
      );
    } else if (!isBareNumberChoiceCard(card) && !hasRichNotes && hasLegacyNotes) {
      add(issues, 'choice.legacy_only', 1, 'choice card only has legacy optionExplanations; migrate important cards to rich option notes');
    }

    const genericCount = optionExplanations.filter((exp) => GENERIC_EXPLANATION_RE.test(compact(exp))).length;
    if (genericCount >= 2) {
      add(issues, 'bad_distractors', 3, 'multiple option explanations are generic instead of explaining the misconception');
    }

    const hasAnyRichField =
      Array.isArray(card.optionMeanings) ||
      Array.isArray(card.optionScenarioImpacts) ||
      Array.isArray(card.optionDirectness);
    if (!hasAnyRichField && options.some((option) => JARGON_RE.test(option))) {
      add(issues, 'jargon_not_explained', 2, 'technical choices include jargon but no rich per-option explanation fields');
    }
  }

  if (JARGON_RE.test(q) && !scenario && !/（|：|:|也就是|即/.test(q)) {
    add(issues, 'jargon_not_explained', 2, 'question contains technical jargon without local definition or scenario');
  }

  if (TRUNCATED_RE.test(text)) {
    add(issues, 'incorrect_or_misleading_explanation', 4, 'explanation looks truncated or cross-generated');
  }

  if (optionExplanations.some((exp) => /GPU\/CPU 不是 embedding 方法的核心区别/.test(exp))) {
    add(issues, 'incorrect_or_misleading_explanation', 4, 'known cross-topic explanation fragment detected');
  }

  // ---- length budgets (minimum information principle) --------------------
  const why = compact(card.why);
  if (why.length > BUDGET.whyError) {
    add(issues, 'too_long.why', 3, `why is ${why.length} chars (budget ${BUDGET.whyError}); split the card or cut to the one decision it teaches`);
  } else if (why.length > BUDGET.whyWarn) {
    add(issues, 'too_long.why', 1, `why is ${why.length} chars (target ≤${BUDGET.whyWarn}); trim to ≤2 sentences`);
  }
  const wow = compact(card.whenOtherWins);
  if (wow.length > BUDGET.whenOtherWins) {
    add(issues, 'too_long.when_other_wins', 2, `whenOtherWins is ${wow.length} chars (budget ${BUDGET.whenOtherWins}); one condition, one sentence`);
  }

  const noteFields = ['optionMeanings', 'optionScenarioImpacts', 'optionDirectness', 'optionExplanations'];
  let revealTotal = why.length + wow.length;
  for (const field of noteFields) {
    const notes = card[field];
    if (!Array.isArray(notes)) continue;
    for (const note of notes) {
      const s = compact(note);
      revealTotal += s.length;
      if (s.length > BUDGET.optionNoteError) {
        add(issues, 'too_long.option_note', 3, `${field} entry is ${s.length} chars (budget ${BUDGET.optionNoteError}); one sentence per option per field`);
        break; // one finding per field is enough
      }
    }
  }
  if (choiceCard(card) && revealTotal > BUDGET.revealTotalWarn) {
    add(issues, 'too_long.reveal_total', 2, `total reveal reading load ≈${revealTotal} chars (target ≤${BUDGET.revealTotalWarn}); the reveal should be scannable in ~30s`);
  }

  // ---- redundancy: option notes must ADD information, not re-read `why` ---
  if (choiceCard(card)) {
    const allNotes = noteFields.flatMap((f) => (Array.isArray(card[f]) ? card[f] : []));
    if (why.length >= 20 && allNotes.some((note) => sharesLongRun(why, compact(note)))) {
      add(issues, 'redundant.why_repeated_in_options', 2, 'an option note repeats a long run of `why` verbatim; each note must add new information');
    }
    if (allNotes.some((note) => TEMPLATE_FILLER_RE.test(compact(note)))) {
      add(issues, 'template_filler', 4, 'option note contains zero-information template filler; write the actual misconception/consequence or delete the note');
    }
  }

  // ---- NBME: the longest option should not give the answer away -----------
  if (choiceCard(card) && Array.isArray(card.answer) && card.answer.length === 1 && options.length >= 3) {
    const correct = compact(options[card.answer[0]] ?? '');
    const distractors = options.filter((_, i) => i !== card.answer[0]).map((o) => compact(o));
    const avg = distractors.reduce((s, o) => s + o.length, 0) / Math.max(1, distractors.length);
    if (correct.length > avg * 1.9 && correct.length > avg + 14) {
      add(issues, 'answer_cue.longest_option', 2, `correct option is ${correct.length} chars vs distractor avg ${Math.round(avg)}; length telegraphs the answer — balance option lengths`);
    }
  }

  // ---- cross-option redundancy: explain a concept ONCE per card ------------
  if (choiceCard(card)) {
    const perOption = options.map((_, i) =>
      ['optionMeanings', 'optionScenarioImpacts', 'optionDirectness', 'optionExplanations']
        .map((f) => (Array.isArray(card[f]) ? compact(card[f][i]) : ''))
        .join(' '),
    );
    outer: for (let i = 0; i < perOption.length; i++) {
      for (let j = i + 1; j < perOption.length; j++) {
        if (perOption[i].length >= 24 && sharesLongRun(perOption[i], perOption[j], 16)) {
          add(issues, 'redundant.cross_option_repeat', 2, `options ${i} and ${j} repeat the same explanation run; explain a concept once per card, then reference it`);
          break outer;
        }
      }
    }
  }

  // ---- number cards: the number is the answer; don't over-explain options ---
  if (choiceCard(card) && isBareNumberChoiceCard(card)) {
    const noteCount = ['optionMeanings', 'optionScenarioImpacts'].reduce(
      (n, f) => n + (Array.isArray(card[f]) ? card[f].filter((s) => compact(s).length > 0).length : 0),
      0,
    );
    if (noteCount >= options.length) {
      add(issues, 'number.over_explained', 1, 'number card carries per-option prose; the number is the number — put the design consequence in `why` only');
    }
  }

  // ---- bilingual: options need English versions ----------------------------
  if (choiceCard(card) && !Array.isArray(card.options_en)) {
    add(issues, 'missing.options_en', 1, 'options have no English versions (options_en); bilingual drill + option TTS need them');
  }
  if (choiceCard(card)) {
    for (const [zhKey, enKey] of OPTION_NOTE_PAIRS) {
      if (Array.isArray(card[zhKey]) && !Array.isArray(card[enKey])) {
        add(issues, `missing.${enKey}`, 1, `${zhKey} exists but ${enKey} is missing; option reveal notes should stay bilingual`);
      }
    }
  }

  // ---- speech coverage: jargon in wrong options should be speakable --------
  if (choiceCard(card) && Array.isArray(card.answer)) {
    const defined = new Set(
      (card.termDefinitions ?? [])
        .filter((t) => compact(t.meaningEn).length > 0)
        .map((t) => compact(t.term).toLowerCase()),
    );
    const missing = new Set();
    options.forEach((option, i) => {
      if (card.answer.includes(i)) return;
      for (const m of compact(option).matchAll(new RegExp(JARGON_RE.source, 'gi'))) {
        const term = m[0].toLowerCase();
        if (!defined.has(term)) missing.add(m[0]);
      }
    });
    if (missing.size >= 2) {
      add(issues, 'speech.jargon_untold', 1, `wrong-option jargon lacks termDefinitions with meaningEn (${[...missing].slice(0, 4).join(', ')}); add speakable definitions`);
    }
  }

  // ---- comparison table (decision matrix) on contrast cards ----------------
  if (choiceCard(card)) {
    const distinctTech = new Set();
    for (const option of options) {
      for (const m of compact(option).matchAll(new RegExp(JARGON_RE.source, 'gi'))) {
        distinctTech.add(m[0].toLowerCase());
      }
    }
    if (card.atomType === 'contrast' && distinctTech.size >= 2 && !card.table) {
      add(issues, 'contrast.missing_comparison_table', 1, `contrast card compares ${distinctTech.size} technologies but has no comparison table (rows=候选, cols=区分维度)`);
    }
  }
  if (card.table && Array.isArray(card.table.headers) && Array.isArray(card.table.rows)) {
    const { headers, rows } = card.table;
    // a column where every row has the same value doesn't help discriminate
    if (rows.length >= 2) {
      for (let col = 1; col < headers.length; col++) {
        const values = rows.map((r) => compact(r[col]));
        if (values.every((v) => v && v === values[0])) {
          add(issues, 'table.non_discriminative', 2, `table column "${compact(headers[col])}" has the same value in every row — swap it for a dimension that separates the options`);
          break;
        }
      }
    }
    const longCell = rows.flat().map((c) => compact(c)).find((c) => c.length > 26);
    if (longCell || headers.some((h) => compact(h).length > 10)) {
      add(issues, 'table.cell_over_budget', 1, 'table cells should be short phrases (cell ≤20, header ≤8 chars target) — move sentences into option notes or why');
    }
  }

  // ---- tradeoff must be explicit on decision cards -------------------------
  if (
    choiceCard(card) &&
    (card.atomType === 'fit' || card.atomType === 'contrast') &&
    !compact(card.tradeoff) &&
    !TRADEOFF_RE.test(`${why} ${wow}`)
  ) {
    add(issues, 'tradeoff.not_explicit', 2, 'fit/contrast card never names the tradeoff axis (X vs Y); add a `tradeoff` field or name both sides in `why`');
  }

  return issues.map((issue) => ({
    ...issue,
    file: rel,
    id: card.id,
    q,
    why: compact(card.why).slice(0, 180),
  }));
}

async function defaultFiles() {
  const files = [];
  for (const track of TRACKS) {
    for await (const rel of glob(`src/content/${track}/*.json`, { cwd: root })) files.push(rel);
  }
  return files.sort();
}

const files = explicitFiles.length ? explicitFiles : await defaultFiles();
const findings = [];
for (const rel of files) {
  const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
  const cards = JSON.parse(fs.readFileSync(abs, 'utf8'));
  if (!Array.isArray(cards)) continue;
  for (const card of cards) findings.push(...auditCard(card, path.relative(root, abs)));
}

findings.sort((a, b) => b.severity - a.severity || a.file.localeCompare(b.file) || a.id.localeCompare(b.id));
const selected = Number.isFinite(limit) && limit > 0 ? findings.slice(0, limit) : findings;

if (asJson) {
  console.log(JSON.stringify({ files: files.length, findings: findings.length, shown: selected.length, selected }, null, 2));
} else {
  console.log(`files: ${files.length}  findings: ${findings.length}  shown: ${selected.length}\n`);
  const byCategory = findings.reduce((acc, f) => {
    acc[f.category] = (acc[f.category] ?? 0) + 1;
    return acc;
  }, {});
  console.log('by category:', JSON.stringify(byCategory));
  console.log('');
  for (const f of selected) {
    console.log(`[S${f.severity}] ${f.category}  ${f.file}  ${f.id}`);
    console.log(`  q: ${f.q}`);
    console.log(`  reason: ${f.reason}`);
    if (f.why) console.log(`  why: ${f.why}`);
    console.log('');
  }
}
