#!/usr/bin/env node
/**
 * Interview-review → atoms card ingest cron (detector / orchestrator).
 *
 * Closes the loop: after each 面试复盘, the `interview-review` command appends a
 * `## Company · Date` section to the three card-source files, each tagged with a
 * marker:  <!-- atoms-source id="2026-07-06-amazon" added="2026-07-06" status="new" -->
 *
 * This script is the DETECTOR. Like the backfill cron, it never writes card
 * content itself — it does the deterministic parts and hands authoring off:
 *
 *   1. scan the three source files for atoms-source marker blocks
 *   2. read the ledger; a block is PENDING if its (file,id) is not ledgered
 *      done AND its marker status is "new"
 *   3. emit one task file per pending block (the block text + an authoring
 *      header pointing at AUTHORING_SPEC) into scripts/review-ingest-tasks/
 *   4. write a report + print a summary
 *   5. authoring is delegated + HUMAN-GATED: an agent turns task files into
 *      candidate decks under src/content/<topic>/ (see REVIEW_INGEST_SPEC.md);
 *      after you accept them, run `--mark-done <id>` to flip the marker to
 *      status="done" and ledger it so it is never reprocessed.
 *
 * Usage:
 *   node scripts/review-ingest-cron.mjs                 # detect + emit task files + report
 *   node scripts/review-ingest-cron.mjs --dry-run       # detect + report only, no task files
 *   node scripts/review-ingest-cron.mjs --json          # machine-readable pending list
 *   node scripts/review-ingest-cron.mjs --list          # show the ledger
 *   node scripts/review-ingest-cron.mjs --mark-done <id>  # accept: flip marker + ledger it
 *   node scripts/review-ingest-cron.mjs --dir <path>    # override source dir (for testing)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const DEFAULT_SRC_DIR = '/Users/yixuanliang/interview/Job_Search/面试复盘';
const SOURCE_FILES = [
  'Interview Action Items.md',
  'Technical_Interview_Questions.md',
  'AI_Agent_Interview_Questions.md',
];
const LEDGER_PATH = path.join(__dirname, 'review-ingest-ledger.json');
const TASK_DIR = path.join(__dirname, 'review-ingest-tasks');
const REPORT_DIR = path.join(root, 'reports');

const MARKER_RE = /<!--\s*atoms-source\s+id="([^"]+)"\s+added="([^"]*)"\s+status="([^"]+)"\s*-->/;

// ---------- args ----------
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const srcDir = opt('--dir', DEFAULT_SRC_DIR);

const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const writeJson = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n');
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Parse a markdown file into marker blocks.
 * A block runs from its `## ` heading (the line above the marker) to the next
 * `## ` heading or EOF. Returns [{ id, added, status, file, heading, text }].
 */
function parseBlocks(file, content) {
  const lines = content.split('\n');
  const blocks = [];
  // index every level-2 heading line
  const headings = [];
  lines.forEach((ln, i) => { if (/^##\s+\S/.test(ln)) headings.push(i); });
  for (let h = 0; h < headings.length; h++) {
    const start = headings[h];
    const end = h + 1 < headings.length ? headings[h + 1] : lines.length;
    // marker must sit within the first few lines of the section
    let marker = null;
    for (let i = start; i < Math.min(start + 4, end); i++) {
      const m = lines[i].match(MARKER_RE);
      if (m) { marker = m; break; }
    }
    if (!marker) continue;
    blocks.push({
      id: marker[1], added: marker[2], status: marker[3],
      file, heading: lines[start].replace(/^##\s+/, '').trim(),
      text: lines.slice(start, end).join('\n').trim(),
    });
  }
  return blocks;
}

function allBlocks() {
  const out = [];
  for (const f of SOURCE_FILES) {
    const p = path.join(srcDir, f);
    if (!fs.existsSync(p)) continue;
    out.push(...parseBlocks(f, fs.readFileSync(p, 'utf8')));
  }
  return out;
}

const ledger = readJson(LEDGER_PATH, { updatedAt: null, done: {} });

// ---------- --list ----------
if (flag('--list')) {
  const ids = Object.keys(ledger.done);
  console.log(`ledger: ${ids.length} block(s) marked done (updated ${ledger.updatedAt ?? 'never'})`);
  for (const k of ids.sort()) console.log(`  ${k}  ${ledger.done[k].doneAt}  (${ledger.done[k].cards ?? '?'} cards)`);
  process.exit(0);
}

// ---------- --mark-done <id> ----------
const markId = opt('--mark-done', null);
if (markId) {
  let flipped = 0;
  for (const f of SOURCE_FILES) {
    const p = path.join(srcDir, f);
    if (!fs.existsSync(p)) continue;
    const before = fs.readFileSync(p, 'utf8');
    const re = new RegExp(`(<!--\\s*atoms-source\\s+id="${markId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*status=")new("\\s*-->)`, 'g');
    const after = before.replace(re, `$1done$2`);
    if (after !== before) { fs.writeFileSync(p, after); flipped++; }
    ledger.done[`${f}#${markId}`] = { doneAt: today() };
  }
  ledger.updatedAt = today();
  writeJson(LEDGER_PATH, ledger);
  console.log(`marked done: id=${markId} (flipped markers in ${flipped} file(s), ledgered)`);
  process.exit(0);
}

// ---------- detect ----------
const blocks = allBlocks();
const pending = blocks.filter((b) => b.status === 'new' && !ledger.done[`${b.file}#${b.id}`]);

if (flag('--json')) {
  console.log(JSON.stringify(pending.map(({ text, ...m }) => m), null, 2));
  process.exit(0);
}

console.log(`scanned ${blocks.length} marked block(s) across ${SOURCE_FILES.length} files`);
console.log(`pending (new, not ledgered): ${pending.length}`);
for (const b of pending) console.log(`  • [${b.file}] ${b.id} — ${b.heading}`);

if (pending.length === 0) { console.log('nothing to do.'); process.exit(0); }

if (!flag('--dry-run')) {
  fs.mkdirSync(TASK_DIR, { recursive: true });
  for (const b of pending) {
    const safe = `${b.id}__${b.file.replace(/[^a-z0-9]+/gi, '-')}`.replace(/-+$/,'');
    const header = [
      `<!-- AUTHORING TASK for atoms card cron. Follow scripts/AUTHORING_SPEC.md (Mode B).`,
      `   Source file: ${b.file}   |   review id: ${b.id}`,
      `   1. Classify each item: knowledge gap → knowledge deck in the matching <topic>;`,
      `      delivery/behavioral gap → interview-drill deck.`,
      `   2. Author candidate cards into src/content/<topic>/ ; validate; do NOT mark done.`,
      `   3. After human accept: node scripts/review-ingest-cron.mjs --mark-done ${b.id}  -->`,
      '', b.text, '',
    ].join('\n');
    fs.writeFileSync(path.join(TASK_DIR, `${safe}.md`), header);
  }
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const report = [
    `# Review-ingest report ${today()}`,
    ``,
    `pending blocks: ${pending.length}`,
    ``,
    ...pending.map((b) => `- **${b.id}** (${b.file}) — ${b.heading}`),
    ``,
    `Task files written to \`scripts/review-ingest-tasks/\`. Hand them to a card-authoring`,
    `agent (see REVIEW_INGEST_SPEC.md). After you accept the generated cards, run`,
    `\`node scripts/review-ingest-cron.mjs --mark-done <id>\` for each id.`,
  ].join('\n');
  fs.writeFileSync(path.join(REPORT_DIR, `review-ingest-${today()}.md`), report + '\n');
  console.log(`\nwrote ${pending.length} task file(s) → scripts/review-ingest-tasks/`);
  console.log(`report → reports/review-ingest-${today()}.md`);
}
