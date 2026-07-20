export const meta = {
  name: 'atoms-fix-card-context',
  description: 'Backfill missing scenarios + kill answer-length cues across every atoms deck file',
  phases: [
    { title: 'Fix', detail: 'one agent per deck file: rewrite to rubric, re-audit until clean' },
    { title: 'Verify', detail: 'rebuild bundle, full audit, report remaining findings' },
  ],
}

const ROOT = '/Users/yixuanliang/interview/Job_Search/system design learning/atoms-app'

function taskPrompt(i) {
  return `You are one worker fixing ONE deck file in Ashlyn's "atoms" system-design drill app.

WORKING DIRECTORY: ${ROOT} (cd into it for every command)

STEP 0 — your assignment:
  Read ${ROOT}/reports/context-fix-worklist.json (a JSON array sorted by findings desc).
  Take the element at index ${i}. It has {file, findings}.
  If index ${i} is out of range, return {file:"", fixed:0, remaining:0, note:"index out of range"} and stop.

STEP 1 — read the standard, then the findings:
  READ ${ROOT}/docs/card-quality-rubric.md — it is the ONLY judge of what "good" means.
  READ ${ROOT}/docs/REGEN_FLOW.md — the process you must follow.
  Then see exactly what is wrong in YOUR file:
    cd ${ROOT} && node scripts/audit-card-quality.mjs "<file>" --limit=0

STEP 2 — fix every finding in YOUR FILE ONLY. Never touch another file.
  HARD RULES (breaking these destroys the user's data):
   - NEVER change any card's \`id\`, \`format\`, or \`atomType\`. SRS learning progress is keyed by id.
   - Edit the deck JSON in place; keep it valid JSON with the same overall shape.
   - Do not delete cards unless rubric Gate 0 says delete (G1 non-technical trivia / G2 no source topic).
     If you delete, list the id + one-line reason in your report.

  The two dominant defects, and what a correct fix looks like:

  (a) \`missing.scenario\` — the card is a decision card with no scenario, so it can only test
      recall. Write a \`scenario\` (≤90 chars, Chinese) that states the SYSTEM and the CONSTRAINT
      that decides the answer — scale, latency budget, consistency need, or cost. The test of a
      good scenario (rubric 1.1-S1): if you changed the constraint, the correct answer would
      change. A scenario that is mere backdrop (delete it and the answer is unaffected) is a
      FAILURE — rubric 1.1-F1. Ground it in the card's own \`why\`/options and the deck's topic;
      never invent facts that contradict the card. Also add \`scenario_en\` (natural spoken
      English carrying the SAME constraint, not a literal translation).
      Example of the bar: "actor/user 信号常采用哪种生产组合？" is contextless. With a scenario it
      becomes answerable alone: "为 1 亿用户的短视频推荐做召回，actor 侧特征要在 50ms 内取到。"

  (b) \`answer_cue.longest_option\` — the correct option is conspicuously the longest, so a learner
      can pick it without understanding. Fix by BALANCING LENGTHS: tighten the correct option
      and/or enrich the distractors so the correct one is NOT the longest. Do NOT fix this by
      making the correct answer vague or wrong. Distractors must stay plausible — each should be
      a real misconception or a choice that would win under a different constraint (rubric 1.2-S1).
      Keep \`options_en\` aligned item-for-item.

  Also fix any other findings the audit reports for your file (too_long.why → ≤2 sentences/120
  chars; redundant.why_repeated_in_options → option notes must add new info, not restate why;
  tradeoff.not_explicit → name the "X vs Y" axis; missing.* visual/unit-model/command items per
  rubric §1.7/§1.8). Consult the rubric for each rule name you see.

STEP 3 — verify YOUR file (this is the loop, keep going until clean or truly stuck):
    cd ${ROOT} && node scripts/validate-deck.mjs "<file>"
    cd ${ROOT} && node scripts/audit-card-quality.mjs "<file>" --limit=0
  Repeat STEP 2 → STEP 3 until the audit reports NO findings for your file, or you have run
  3 full passes. validate-deck must pass — if it errors, you broke the JSON: fix it before returning.

Return: {file, fixed (findings resolved), remaining (findings still reported), deleted (ids you
removed, or []), note (short — e.g. "clean" or "3 left: table.cell_over_budget needs a rewrite of
the comparison table")}.`
}

phase('Fix')
const WORKLIST_LEN = 219
const indices = Array.from({ length: WORKLIST_LEN }, (_, i) => i)
const results = await parallel(indices.map((i) => () =>
  agent(taskPrompt(i), {
    label: `fix #${i}`,
    phase: 'Fix',
    effort: 'high',
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        fixed: { type: 'integer' },
        remaining: { type: 'integer' },
        deleted: { type: 'array', items: { type: 'string' } },
        note: { type: 'string' },
      },
      required: ['file', 'fixed', 'remaining'],
    },
  })
))

const done = results.filter(Boolean)
const totalFixed = done.reduce((a, r) => a + (r.fixed || 0), 0)
const totalLeft = done.reduce((a, r) => a + (r.remaining || 0), 0)
log(`Fixed ${totalFixed} findings across ${done.length} files; ${totalLeft} remain.`)

phase('Verify')
const verify = await agent(
  `Rebuild the atoms deck bundle and report the FINAL audit state.
   Run, in order, from ${ROOT}:
     node scripts/validate-deck.mjs
     npm run build:deck
     node scripts/audit-card-quality.mjs --limit=0 2>&1 | grep -oE '^\\[S[0-9]\\] [a-z_.]+' | sort | uniq -c | sort -rn
   Report: whether validate-deck passed, whether build:deck succeeded, and the FULL final
   per-rule findings table verbatim. If any command fails, report its exact error output.
   Do NOT edit any card files — you are only verifying.`,
  { label: 'rebuild + final audit', phase: 'Verify', effort: 'low' }
)

return {
  files_processed: done.length,
  findings_fixed: totalFixed,
  findings_remaining: totalLeft,
  deleted_cards: done.flatMap((r) => r.deleted || []),
  worst_remaining: done.filter((r) => (r.remaining || 0) > 0)
    .sort((a, b) => b.remaining - a.remaining).slice(0, 15)
    .map((r) => ({ file: r.file, remaining: r.remaining, note: r.note })),
  verify_report: verify,
}
