export const meta = {
  name: 'atoms-fix-length-cue',
  description: 'Kill the answer-is-longest cue by making distractors as concrete as the correct option',
  phases: [
    { title: 'Fix', detail: 'one agent per deck file: rebalance flagged MCQs, re-audit' },
    { title: 'Verify', detail: 'rebuild bundle, re-run audit + coverage gates' },
  ],
}

const ROOT = '/Users/yixuanliang/interview/Job_Search/system design learning/atoms-app'
const N = 236

function taskPrompt(i) {
  return `You fix answer-length leakage in ONE deck file of Ashlyn's "atoms" system-design app.

WORKING DIRECTORY: ${ROOT}

THE PROBLEM (read this carefully, it decides HOW you fix):
  Across this library the correct option is the longest choice on ~63% of single-answer MCQs
  (random baseline for 4 options is 25%). A learner unconsciously learns "pick the longest" and
  scores well without understanding — which also corrupts their sense of what they've mastered.

  The RIGHT fix is almost never to shorten the correct answer into something vague. It is to make
  the DISTRACTORS as concrete and specific as the correct option. A short distractor ("只决定视频
  清晰度") is usually a lazy fake that also violates rubric 1.2-S1 ("每个错误选项 = 一个工程师真会
  犯的误解，或一个换个前提就赢的真实方案"). So you are usually fixing TWO defects at once: the
  length cue AND weak distractors. Rewrite weak distractors into plausible, homogeneous, same-
  granularity wrong answers a real engineer might pick — then the lengths even out naturally.
  Only trim the correct option when it is genuinely padded with filler.

STEP 0 — your assignment:
  Read ${ROOT}/reports/length-fix-worklist.json (JSON array). Take element at index ${i}: {file, cards}.
  If index ${i} is out of range, return {file:"", fixed:0, note:"index out of range"} and stop.

STEP 1 — find the flagged cards in YOUR file only:
  cd "${ROOT}" && node scripts/audit-card-quality.mjs "<file>" --limit=0
  Look for 'answer_cue.longest_option' and 'answer_cue.longest_option_mild'. Those are your targets.
  Also read ${ROOT}/docs/card-quality-rubric.md §1.2 (options) and appendix B before editing.

STEP 2 — for each flagged card, rebalance the options so the correct one is NOT the longest
  (a 1-2 char margin is fine). Keep them same-granularity and plausible per 1.2-S1. Update
  options_en to stay aligned item-for-item, and if you rewrite a distractor, update its entry in
  optionExplanations / optionScenarioImpacts / optionMeanings so the note still matches the new
  wording (a note explaining an option that no longer exists is a bug). Do NOT change which option
  is correct, and NEVER change any card's id / format / atomType / answer index-to-meaning mapping
  in a way that alters the correct answer. Ground everything in the card's own why + the topic;
  invent no new facts.

STEP 3 — verify, loop until clean:
    cd "${ROOT}" && node scripts/validate-deck.mjs "<file>"
    cd "${ROOT}" && node scripts/audit-card-quality.mjs "<file>" --limit=0
  Goal: zero 'answer_cue.longest_option' AND zero 'answer_cue.longest_option_mild' for your file,
  and you introduced no new findings of any other kind. Up to 3 passes. validate-deck MUST pass.
  If a specific card genuinely cannot be balanced without making the correct answer wrong, leave it
  and explain in note — correctness beats the length rule.

Return: {file, fixed (flagged cards you rebalanced), remaining (length findings still reported),
distractors_rewritten (how many weak distractors you upgraded), note (one line)}.`
}

phase('Fix')
const results = await parallel(Array.from({ length: N }, (_, i) => i).map((i) => () =>
  agent(taskPrompt(i), {
    label: `len #${i}`,
    phase: 'Fix',
    effort: 'high',
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        fixed: { type: 'integer' },
        remaining: { type: 'integer' },
        distractors_rewritten: { type: 'integer' },
        note: { type: 'string' },
      },
      required: ['file', 'fixed'],
    },
  })
))

const done = results.filter(Boolean)
const fixed = done.reduce((a, r) => a + (r.fixed || 0), 0)
const upgraded = done.reduce((a, r) => a + (r.distractors_rewritten || 0), 0)
const left = done.reduce((a, r) => a + (r.remaining || 0), 0)
log(`Rebalanced ${fixed} cards, upgraded ${upgraded} weak distractors; ${left} length findings remain.`)

phase('Verify')
const verify = await agent(
  `Rebuild the atoms card library and report its final quality state. From ${ROOT} run in order:
     node scripts/validate-deck.mjs
     npm run build:deck
     node scripts/audit-card-quality.mjs --limit=0 2>&1 | grep -oE '^\\[S[0-9]\\] [a-z_.]+' | sort | uniq -c | sort -rn
     npm run coverage:audit
   Report verbatim whether validate and build passed, the full per-rule findings table, and the
   coverage gate's final line. Report exact errors if any command fails. Do NOT edit any file.`,
  { label: 'rebuild + gates', phase: 'Verify', effort: 'low' },
)

return {
  files: done.length,
  cards_rebalanced: fixed,
  distractors_upgraded: upgraded,
  length_findings_remaining: left,
  worst: done.filter((r) => (r.remaining || 0) > 0).sort((a, b) => b.remaining - a.remaining)
    .slice(0, 12).map((r) => ({ file: r.file, remaining: r.remaining, note: r.note })),
  verify_report: verify,
}
