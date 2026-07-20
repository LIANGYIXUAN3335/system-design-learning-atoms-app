export const meta = {
  name: 'atoms-fill-coverage',
  description: 'Write new cards for the knowledge points the coverage audit found uncovered',
  phases: [
    { title: 'Fill', detail: 'one agent per deck: write cards for its missing points, then verify' },
    { title: 'Verify', detail: 'rebuild bundle, re-run quality + coverage gates' },
  ],
}

const ROOT = '/Users/yixuanliang/interview/Job_Search/system design learning/atoms-app'
const N = 121

function taskPrompt(i) {
  return `You write NEW drill cards for ONE deck in Ashlyn's "atoms" system-design app, closing gaps a
coverage audit already identified. She is interviewing for mid/senior backend roles.

WORKING DIRECTORY: ${ROOT}

STEP 0 — your assignment:
  Read ${ROOT}/reports/fill-worklist.json (JSON array). Take element at index ${i}:
  {slug, track, article_path, deck_path, words, cards, coverage_pct, note, missing:[{point,value}]}.
  If index ${i} is out of range, return {slug:"", added:0, note:"index out of range"} and stop.
  \`note\` tells you the SHAPE of what is missing in this deck — read it first, it is the audit's own
  diagnosis. \`missing\` lists the specific uncovered knowledge points (value high | medium).

STEP 1 — read the standard and the source:
  READ ${ROOT}/docs/card-quality-rubric.md — the ONLY definition of a good card. Follow every
  field judgement in §1, plus Gate 0. Note especially:
    - 1.1-S1: the scenario must carry the CONSTRAINT that decides the answer. If changing the
      constraint would not change the answer, the scenario is decoration and the card fails.
    - 1.2-S1/S3: distractors must be real misconceptions or options that win under a different
      premise, and the correct option must NOT be the longest. Balance the lengths deliberately —
      75% of this library's existing cards leak the answer by length; do not add to that.
    - 1.4: \`why\` ≤2 sentences, name the tradeoff axis, and say what the winning option COSTS.
  READ the source article at "article_path" — especially the sections your missing points come
  from. The audit found cards are generated from the top of the article and run out partway down,
  so your points usually live in the LATTER half: deep dives, failure modes, capacity math.

STEP 2 — write one card per missing point, prioritising value:"high" first.
  Ground every card in the article. Do NOT invent mechanisms, numbers, or claims the article does
  not make. If a listed point turns out to be already covered by an existing card, or too thin to
  make a real decision card, SKIP it and say so in your note — a smaller set of real cards beats
  padding.

  The three card types this library is most starved of — write these well:
   - **被否决方案的失败机制**: not "which option wins" but "HOW does the rejected option break".
     Put the reader inside the failure: what state goes wrong, and what the user/system sees.
   - **容量估算**: per rubric 1.4-S5 give the formula, expand every abbreviation and unit, and say
     what the number is USED for downstream. If a number is a given SLO rather than a derived
     result, say so explicitly and test which design path it constrains.
   - **运维现实 / 故障恢复**: per rubric 1.4-S4 walk the full state loop — normal path → failure →
     intermediate state → recovery action → the cost of recovering.

STEP 3 — append to the deck JSON at "deck_path":
  HARD RULES:
   - The file is a JSON array of card objects. APPEND your new cards; never modify or reorder
     existing ones, and never touch any existing card's \`id\`, \`format\`, or \`atomType\` (SRS
     progress is keyed by id).
   - New ids follow the deck's existing convention, continuing the numbering (look at the last
     card's id — e.g. \`sd-deep-dives-kafka-065\` → your first new one is \`-066\`). Ids must be unique.
   - Match the field shape of existing cards in THIS deck exactly: q, q_en, scenario, scenario_en,
     options, options_en, answer (array of indices), optionExplanations, optionExplanations_en,
     why, why_en, tags, topic, termDefinitions, plus tradeoff/whenOtherWins where the rubric requires.
   - Keep the file valid JSON.

STEP 4 — verify, and loop until clean:
    cd "${ROOT}" && node scripts/validate-deck.mjs "<deck_path>"
    cd "${ROOT}" && node scripts/audit-card-quality.mjs "<deck_path>" --limit=0
  Your new cards must add ZERO new findings. If the audit flags them, fix and re-run (up to 3
  passes). validate-deck MUST pass — if it errors you broke the JSON; fix it before returning.
  Pre-existing findings on OLD cards are not yours to fix — another workflow owns those. Only
  ensure you added none.

Return: {slug, added (cards written), skipped (points you deliberately skipped), remaining_findings
(new findings your cards still trigger, ideally 0), note (one line: what you added and anything
you could not close)}.`
}

phase('Fill')
const results = await parallel(Array.from({ length: N }, (_, i) => i).map((i) => () =>
  agent(taskPrompt(i), {
    label: `fill #${i}`,
    phase: 'Fill',
    effort: 'high',
    schema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        added: { type: 'integer' },
        skipped: { type: 'integer' },
        remaining_findings: { type: 'integer' },
        note: { type: 'string' },
      },
      required: ['slug', 'added'],
    },
  })
))

const done = results.filter(Boolean)
const added = done.reduce((a, r) => a + (r.added || 0), 0)
log(`Added ${added} new cards across ${done.length} decks.`)

phase('Verify')
const verify = await agent(
  `Rebuild and report the final state of the atoms card library. From ${ROOT} run, in order:
     node scripts/validate-deck.mjs
     npm run build:deck
     node scripts/audit-card-quality.mjs --limit=0 2>&1 | grep -oE '^\\[S[0-9]\\] [a-z_.]+' | sort | uniq -c | sort -rn
     npm run coverage:audit
   Report verbatim: whether validate and build succeeded, the full per-rule findings table, and the
   coverage gate's final line (how many decks are still under-covered). Report exact errors if any
   command fails. Do NOT edit any card files — verification only.`,
  { label: 'rebuild + gates', phase: 'Verify', effort: 'low' },
)

return {
  decks: done.length,
  cards_added: added,
  points_skipped: done.reduce((a, r) => a + (r.skipped || 0), 0),
  decks_with_new_findings: done.filter((r) => (r.remaining_findings || 0) > 0)
    .map((r) => ({ slug: r.slug, findings: r.remaining_findings, note: r.note })),
  verify_report: verify,
}
