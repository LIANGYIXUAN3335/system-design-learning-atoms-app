#!/usr/bin/env node
/**
 * Rubric-driven content quality backfill cron (m3-spec §4.0 / §4.0.1).
 *
 * The cron is an ORCHESTRATOR — it never writes card content itself. Card
 * repair is delegated to a headless agent (Codex for generation by default,
 * Claude as judge); this script does the deterministic parts:
 *
 *   1. read rubric version (front-matter `version:`)
 *   2. read the run ledger; no-op when nothing changed and nothing is pending
 *   3. pick decks: track priority (system-design > llm-sd > rest), then
 *      audit-error density
 *   4. per deck: snapshot stimulus hashes → hand a repair task to the
 *      executor → machine gates (validate + audit error=0)
 *   5. change-level firewall: any card whose stimulus (q/scenario/options/
 *      answer) changed is rolled back whole and quarantined for human review
 *      (its rewritten version is preserved under reports/quarantine/)
 *   6. judge sampling (Claude, different model family from the generator);
 *      failed cards are NOT ledgered → they get re-repaired next night
 *   7. build:deck + verify → eas update (three machine gates, no human gate)
 *   8. write report + update ledger
 *
 * Usage:
 *   node scripts/content-quality-backfill-cron.mjs                  # full nightly run
 *   node scripts/content-quality-backfill-cron.mjs --dry-run        # plan only, no executor
 *   node scripts/content-quality-backfill-cron.mjs --executor manual# emit task files, run nothing
 *   node scripts/content-quality-backfill-cron.mjs --deck src/content/system-design/core-concepts_caching.json
 *   flags: --max-decks N (default 3) · --no-publish · --executor codex|claude|manual
 *          --gen-model <id> (default gpt-5.5-high) · --judge-model <id> (default claude-sonnet-5)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const LEDGER_PATH = path.join(root, 'scripts', 'backfill-ledger.json');
const RUBRIC_PATH = path.join(root, 'docs', 'card-quality-rubric.md');
const REPORT_DIR = path.join(root, 'reports');
const QUARANTINE_DIR = path.join(REPORT_DIR, 'quarantine');
const TASK_DIR = path.join(root, 'scripts', 'backfill-tasks');

/** user decision 2026-07-03: classic SD first, LLM SD second, the rest last */
const TRACK_PRIORITY = { 'system-design': 0, 'llm-sd': 1, 'ai-coding': 2, 'low-level-design': 2 };
const TRACKS = Object.keys(TRACK_PRIORITY);

// ---------- args ----------
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const cfg = {
  dryRun: flag('--dry-run'),
  publish: !flag('--no-publish'),
  /** parallel mode: repair+gate+ledger only; the scheduler runs build/verify/publish once at the end */
  skipBuild: flag('--skip-build'),
  executor: opt('--executor', 'codex'), // codex | claude | manual
  maxDecks: Number(opt('--max-decks', '3')),
  genModel: opt('--gen-model', 'default'), // 'default' = whatever ~/.codex/config.toml sets (user keeps 5.5-high there)
  judgeModel: opt('--judge-model', 'claude-sonnet-5'),
  onlyDeck: opt('--deck', null),
  judgeSample: Number(opt('--judge-sample', '10')),
};

const log = (...a) => console.log(`[backfill ${new Date().toISOString().slice(11, 19)}]`, ...a);

// ---------- small utils ----------
const readJson = (p, dflt) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return dflt;
  }
};
const writeJson = (p, obj) => fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

/** stimulus = what the learner's memory is anchored to; changing it = new card */
function stimulusHash(card) {
  const norm = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v);
  return sha1(
    JSON.stringify({
      q: norm(card.q),
      scenario: norm(card.scenario ?? ''),
      options: (card.options ?? []).map(norm),
      answer: card.answer ?? null,
      text: norm(card.text ?? ''),
      steps: (card.steps ?? []).map(norm),
      answerOrder: card.answerOrder ?? null,
    }),
  );
}

function rubricVersion() {
  const head = fs.readFileSync(RUBRIC_PATH, 'utf8').slice(0, 500);
  const m = head.match(/^version:\s*(\S+)/m);
  if (!m) throw new Error('rubric has no `version:` front-matter — add one, it is the cron trigger');
  return m[1];
}

function run(cmd, cmdArgs, opts = {}) {
  log('$', cmd, cmdArgs.join(' ').slice(0, 160));
  const res = spawnSync(cmd, cmdArgs, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: opts.timeoutMs ?? 45 * 60 * 1000,
    ...opts,
  });
  return { code: res.status ?? -1, out: (res.stdout ?? '') + (res.stderr ?? '') };
}

// ---------- audit aggregation ----------
function auditFindings(target) {
  const a = run('node', ['scripts/audit-card-quality.mjs', ...(target ? [target] : []), '--json', '--limit=0'], { timeoutMs: 5 * 60 * 1000 });
  const jsonStart = a.out.indexOf('{');
  if (jsonStart < 0) throw new Error('audit produced no JSON: ' + a.out.slice(0, 300));
  const parsed = JSON.parse(a.out.slice(jsonStart));
  return parsed.selected ?? [];
}

function deckFiles() {
  const files = [];
  for (const track of TRACKS) {
    const dir = path.join(root, 'src', 'content', track);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      files.push({ track, rel: path.join('src', 'content', track, f) });
    }
  }
  return files;
}

// ---------- main ----------
fs.mkdirSync(REPORT_DIR, { recursive: true });
fs.mkdirSync(QUARANTINE_DIR, { recursive: true });
fs.mkdirSync(TASK_DIR, { recursive: true });

const version = rubricVersion();
const ledger = readJson(LEDGER_PATH, { rubricVersion: null, cards: {} });
const today = new Date().toISOString().slice(0, 10);
const report = [];
const rpt = (line) => {
  report.push(line);
  log(line);
};

rpt(`# Backfill report ${today}`);
rpt(`rubric version: ${version} (ledger last saw: ${ledger.rubricVersion ?? 'never'})`);
rpt(`executor: ${cfg.executor} (gen=${cfg.genModel}, judge=${cfg.judgeModel}) · publish: ${cfg.publish} · dry-run: ${cfg.dryRun}`);

// -- step 1-2: plan --------------------------------------------------------
const allFindings = auditFindings(null);
const findingsByDeck = new Map();
for (const f of allFindings) {
  const key = f.file;
  if (!findingsByDeck.has(key)) findingsByDeck.set(key, { errors: 0, warns: 0 });
  const bucket = findingsByDeck.get(key);
  if (f.severity >= 3) bucket.errors++;
  else bucket.warns++;
}

const plan = [];
for (const { track, rel } of deckFiles()) {
  if (cfg.onlyDeck && path.normalize(rel) !== path.normalize(cfg.onlyDeck)) continue;
  const cards = readJson(path.join(root, rel), []);
  if (!Array.isArray(cards) || cards.length === 0) continue;
  const pending = cards.filter((c) => ledger.cards[c.id]?.v !== version).map((c) => c.id);
  if (pending.length === 0) continue; // converged under this rubric version
  const agg = findingsByDeck.get(rel) ?? { errors: 0, warns: 0 };
  plan.push({ track, rel, pending, score: agg.errors * 10 + agg.warns, errors: agg.errors, warns: agg.warns });
}
plan.sort((a, b) => TRACK_PRIORITY[a.track] - TRACK_PRIORITY[b.track] || b.score - a.score || a.rel.localeCompare(b.rel));

if (plan.length === 0) {
  rpt('nothing to do: every card has passed the current rubric version. (This is the self-degrading no-op.)');
  fs.writeFileSync(path.join(REPORT_DIR, `backfill-${today}.md`), report.join('\n') + '\n');
  process.exit(0);
}

const batch = plan.slice(0, cfg.maxDecks);
rpt(`\ndecks pending: ${plan.length} · tonight's batch: ${batch.map((d) => `${d.rel} (${d.pending.length} cards, E${d.errors}/W${d.warns})`).join(' · ')}`);

if (cfg.dryRun) {
  rpt('\n--dry-run: stopping after planning.');
  fs.writeFileSync(path.join(REPORT_DIR, `backfill-${today}.md`), report.join('\n') + '\n');
  process.exit(0);
}

// -- step 3: repair each deck ----------------------------------------------
function repairPrompt(deck, cardIds, taskPath) {
  return `你在 "${root}" 仓库工作。任务：按既定规范修复一批学习卡片的质量。这是自动化夜间管线的一部分，不要提问，直接执行。

1. 先完整读这四个文件（它们是唯一标准，不要凭默认审美发挥）：
   - docs/card-quality-rubric.md    （判据总库：Gate 0 + 逐字段 S/F + 讲解十二律 + 附录A机检规则）
   - docs/judge-calibration.md      （四个解析形状的 fail/pass 对照样本）
   - docs/REGEN_FLOW.md             （五步循环与硬性禁止）
   - scripts/AUTHORING_SPEC.md      （card JSON schema 细节）

2. 只修这个文件里的这些卡（其余卡一个字都不要动）：
   deck: ${deck}
   目标卡 id（共 ${cardIds.length} 张）：${cardIds.join(', ')}

3. 对每张目标卡执行 REGEN_FLOW Step 1-2（Gate 0 裁决 + 逐字段重写）。
   ⚠️ 本管线的额外硬约束（比 REGEN_FLOW 更严）：**不得改动 q / scenario / options / answer / text / steps / answerOrder 的语义**
   ——只允许修解释侧字段（why / why_en / 选项解析三字段及 _en / tradeoff / whenOtherWins /
   termDefinitions(含 fullName) / table / diagram / codeSample / q_en / scenario_en / options_en / tags）。
   如果某张卡按 Gate 0 应该删除或必须改题干才能救，不要动它，把它的 id 和一句理由写进
   ${taskPath}.needs-human.txt（一行一条）。

4. 修完后自检：node scripts/validate-deck.mjs ${deck} && node scripts/audit-card-quality.mjs ${deck} --limit=0
   audit 的 error 必须为 0（warn 可以残留）。不过就修到过为止。

5. 完成后输出一行统计：修复卡数、跳过卡数、needs-human 数。`;
}

const executors = {
  codex(promptFile) {
    const prompt = `Read the task file at ${promptFile} and execute it fully.`;
    // default: use the model configured in ~/.codex/config.toml (user keeps
    // 5.5-high there); pass --gen-model to override explicitly.
    const modelArgs = cfg.genModel === 'default' ? [] : ['-m', cfg.genModel];
    const extra = process.env.BACKFILL_CODEX_ARGS ? process.env.BACKFILL_CODEX_ARGS.split(' ') : [];
    return run('codex', ['exec', '-s', 'workspace-write', ...modelArgs, ...extra, prompt]);
  },
  claude(promptFile) {
    const prompt = `Read the task file at ${promptFile} and execute it fully.`;
    return run('claude', ['-p', prompt, '--model', cfg.genModel, '--settings', '{"effortLevel":"high"}', '--permission-mode', 'acceptEdits']);
  },
  manual(promptFile) {
    log(`manual executor: task written to ${promptFile}; run it yourself, then re-run with --deck to gate+ledger it.`);
    return { code: 0, out: 'manual' };
  },
};

let anyDeckShipped = false;

for (const deck of batch) {
  rpt(`\n## ${deck.rel}`);
  const deckAbs = path.join(root, deck.rel);
  const before = readJson(deckAbs, []);
  const beforeById = new Map(before.map((c) => [c.id, c]));
  const snapshot = new Map(before.map((c) => [c.id, { hash: stimulusHash(c), card: c }]));
  const beforeErrors = (findingsByDeck.get(deck.rel) ?? { errors: 0 }).errors;

  // hand off to executor
  const taskPath = path.join(TASK_DIR, `${today}__${deck.rel.replace(/[\\/]/g, '__')}.task.md`);
  fs.writeFileSync(taskPath, repairPrompt(deck.rel, deck.pending, taskPath));
  const ex = executors[cfg.executor](taskPath);
  if (cfg.executor === 'manual') continue;
  if (ex.code !== 0) {
    rpt(`executor FAILED (exit ${ex.code}) — deck skipped, will retry next night. tail: ${ex.out.slice(-300)}`);
    continue;
  }

  // machine gate 1: schema
  const v = run('node', ['scripts/validate-deck.mjs', deck.rel], { timeoutMs: 5 * 60 * 1000 });
  if (v.code !== 0) {
    rpt(`validate-deck FAILED — rolling the whole deck back via git. tail: ${v.out.slice(-300)}`);
    run('git', ['checkout', '--', deck.rel]);
    continue;
  }

  // change-level firewall: quarantine stimulus changes (whole-card rollback,
  // rewritten version preserved for human review)
  const after = readJson(deckAbs, []);
  const afterById = new Map(after.map((c) => [c.id, c]));
  const quarantined = [];
  const repaired = [];
  const finalCards = after.map((c) => {
    const snap = snapshot.get(c.id);
    if (!snap) return c; // agent 不该加卡；validate 已挡新 id 冲突，保守保留
    if (deck.pending.includes(c.id) && stimulusHash(c) !== snap.hash) {
      writeJson(path.join(QUARANTINE_DIR, `${today}__${c.id}.json`), { reason: 'stimulus changed (Level 2)', original: snap.card, rewritten: c });
      quarantined.push(c.id);
      return snap.card; // roll back whole card; its rewrite is preserved above
    }
    if (deck.pending.includes(c.id)) repaired.push(c.id);
    return c;
  });
  // cards the agent deleted (Gate 0) — keep the deletion only if it wrote a needs-human note? No:
  // pipeline hard rule says agent must not delete; restore anything missing.
  for (const c of before) if (!afterById.has(c.id)) finalCards.push(c) && quarantined.push(c.id);
  writeJson(deckAbs, finalCards);

  // machine gate 2: audit errors must be zero
  const auditAfter = auditFindings(deck.rel);
  const errAfter = auditAfter.filter((f) => f.severity >= 3).length;
  if (errAfter > 0) {
    rpt(`audit still has ${errAfter} errors after repair — deck NOT ledgered, retrying next night. sample: ${auditAfter.filter((f) => f.severity >= 3).slice(0, 3).map((f) => `${f.id}:${f.category}`).join(', ')}`);
    continue;
  }

  // judge sampling (Claude — different family from the generator on purpose)
  let judgeFails = [];
  const sample = repaired.sort(() => Math.random() - 0.5).slice(0, cfg.judgeSample);
  if (sample.length > 0) {
    const sampleCards = finalCards.filter((c) => sample.includes(c.id));
    const judgePromptPath = path.join(TASK_DIR, `${today}__judge__${deck.rel.replace(/[\\/]/g, '__')}.md`);
    fs.writeFileSync(
      judgePromptPath,
      `你是卡片质量 judge。先读 ${root}/docs/judge-calibration.md（fail/pass 判例）。然后对下面每张卡按四个形状 + 答案泄漏 + 英文口语度打分。对每卡输出一行：<id> PASS 或 <id> FAIL <一句理由>。最后必须输出一行：FAIL_IDS: <逗号分隔的 fail id 列表，无则留空>。\n\n${JSON.stringify(sampleCards, null, 1)}`,
    );
    const j = run('claude', ['-p', `Read and execute the judging task in ${judgePromptPath}.`, '--model', cfg.judgeModel], { timeoutMs: 15 * 60 * 1000 });
    const m = j.out.match(/FAIL_IDS:\s*(.*)/);
    judgeFails = m && m[1].trim() ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
    rpt(`judge: sampled ${sample.length}, failed ${judgeFails.length}${judgeFails.length ? ` (${judgeFails.join(', ')})` : ''}`);
    const judgeLines = j.out.split('\n').filter((l) => / (PASS|FAIL)/.test(l)).slice(0, 20);
    report.push(...judgeLines.map((l) => `  - ${l.trim()}`));
  }

  // ledger: passed cards only; judge-fails stay unledgered → auto-retry next night
  for (const id of repaired) {
    if (judgeFails.includes(id)) continue;
    const card = finalCards.find((c) => c.id === id);
    ledger.cards[id] = { v: version, hash: stimulusHash(card) };
  }
  anyDeckShipped = true;
  rpt(`repaired ${repaired.length - judgeFails.length} · quarantined ${quarantined.length}${quarantined.length ? ` (${quarantined.join(', ')})` : ''} · audit errors ${beforeErrors}→0`);
}

// read-merge-write: parallel per-deck processes each ledger their own cards;
// merging on save means a lost race only costs a redundant re-repair (idempotent).
const latest = readJson(LEDGER_PATH, { rubricVersion: null, cards: {} });
ledger.cards = { ...latest.cards, ...ledger.cards };
ledger.rubricVersion = version;
writeJson(LEDGER_PATH, ledger);

// -- step 7: build + verify + publish ---------------------------------------
if (cfg.skipBuild) {
  rpt('\n--skip-build: repair+gates+ledger done; scheduler will build/verify/publish once at the end.');
} else if (anyDeckShipped) {
  const b = run('npm', ['run', 'build:deck'], { timeoutMs: 10 * 60 * 1000 });
  const t = run('npm', ['run', 'verify'], { timeoutMs: 20 * 60 * 1000 });
  if (b.code !== 0 || t.code !== 0) {
    rpt(`build/verify FAILED (build=${b.code}, verify=${t.code}) — NOT publishing. tail: ${(b.code !== 0 ? b.out : t.out).slice(-400)}`);
  } else if (cfg.publish) {
    const p = run('npx', ['eas', 'update', '--branch', 'production', '--message', `backfill ${today} rubric ${version}`, '--non-interactive'], { timeoutMs: 15 * 60 * 1000 });
    rpt(p.code === 0 ? 'published via EAS Update ✓' : `eas update failed (exit ${p.code}) — likely expo-updates not configured yet (one-time setup: npx expo install expo-updates && eas update:configure, then one APK rebuild). tail: ${p.out.slice(-300)}`);
  } else {
    rpt('publish skipped (--no-publish).');
  }
} else {
  rpt('\nno deck shipped tonight; nothing to build/publish.');
}

const reportName = cfg.onlyDeck
  ? `backfill-${today}__${path.basename(cfg.onlyDeck, '.json')}.md`
  : `backfill-${today}.md`;
fs.writeFileSync(path.join(REPORT_DIR, reportName), report.join('\n') + '\n');
log(`report → reports/${reportName}`);
