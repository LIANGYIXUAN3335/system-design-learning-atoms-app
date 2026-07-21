export const meta = {
  name: 'atoms-fill-coverage-remainder',
  description: 'Bring the last 14 under-covered decks up to the source-coverage floor',
  phases: [
    { title: 'Fill', detail: 'one agent per under-covered deck: write the missing cards, verify' },
    { title: 'Verify', detail: 'rebuild bundle, re-run quality + coverage gates' },
  ],
}

const ROOT = '/Users/yixuanliang/interview/Job_Search/system design learning/atoms-app'
const N = 14

function taskPrompt(i) {
  return `You write NEW drill cards for ONE deck in Ashlyn's "atoms" system-design app. This deck is
below the source-coverage floor: its article has more interview-relevant material than the deck has
cards. She is interviewing for mid/senior backend roles.

WORKING DIRECTORY: ${ROOT}

STEP 0 — your assignment:
  Read ${ROOT}/reports/coverage-remainder-worklist.json (JSON array). Take element at index ${i}:
  {slug, track, article_path, deck_path, cards, need, short, note, missing:[{point,value}]}.
  If index ${i} is out of range, return {slug:"", added:0, note:"index out of range"} and stop.
  You must add at least \`short\` cards to reach the floor. \`note\` is the audit's diagnosis of what
  is missing; \`missing\` lists specific uncovered knowledge points (value high | medium).

STEP 1 — read the standard and the source:
  READ ${ROOT}/docs/card-quality-rubric.md (the ONLY definition of good; follow Gate 0, §1 fields,
  and appendix B on the length cue). READ the source article at "article_path", focusing on the
  LATTER half — the audit found decks are built top-down and run out there, so the uncovered points
  (deep dives, failure modes, capacity math, follow-ups) live near the end.

STEP 2 — write one real decision card per missing point, value:"high" first, until you have at
  least \`short\` new cards. Ground every card in the article; invent no facts. Skip a listed point
  only if it is already covered or too thin to make a real decision card (note it).
  Write especially these under-represented types well:
   - 被否决方案的失败机制 (how the rejected option breaks, with the intermediate bad state)
   - 容量估算 (formula + expand every unit/abbrev + what the number is used for downstream)
   - 运维/故障恢复 (normal → failure → intermediate state → recovery → cost)
  CRITICAL on options (this library's #1 defect): the correct option must NOT be the longest, and
  every distractor must be a real misconception a same-level engineer could pick — same
  granularity, comparable length. Never write a short throwaway distractor.

STEP 3 — APPEND to the deck JSON at "deck_path":
   - JSON array of card objects. APPEND only; never modify/reorder existing cards; never change any
     existing card's id / format / atomType (SRS progress is keyed by id).
   - New ids continue the deck's numbering convention (look at the last card's id). Unique ids.
   - Match the field shape of existing cards in THIS deck exactly (q, q_en, scenario, scenario_en,
     options, options_en, answer [array of indices], optionExplanations, optionExplanations_en,
     why, why_en, tags, topic, termDefinitions, plus tradeoff/whenOtherWins where §1 requires).
   - Keep the file valid JSON.

STEP 4 — verify, loop until clean (up to 3 passes):
    cd "${ROOT}" && node scripts/validate-deck.mjs "<deck_path>"
    cd "${ROOT}" && node scripts/audit-card-quality.mjs "<deck_path>" --limit=0
    cd "${ROOT}" && node scripts/audit-coverage.mjs "<deck_path>"
  Goal: coverage gate passes for this deck (exit 0) AND your new cards add zero audit findings.
  validate-deck MUST pass. Pre-existing findings on OLD cards are not yours.

Return: {slug, added, skipped, coverage_met (true if audit-coverage now passes for this deck),
new_findings (audit findings your cards triggered, ideally 0), note}.`
}

phase('Fill')
const results = await parallel(Array.from({ length: N }, (_, i) => i).map((i) => () =>
  agent(taskPrompt(i), {
    label: `fill-rem #${i}`,
    phase: 'Fill',
    model: 'sonnet',
    effort: 'high',
    schema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        added: { type: 'integer' },
        skipped: { type: 'integer' },
        coverage_met: { type: 'boolean' },
        new_findings: { type: 'integer' },
        note: { type: 'string' },
      },
      required: ['slug', 'added'],
    },
  })
))

const done = results.filter(Boolean)
const added = done.reduce((a, r) => a + (r.added || 0), 0)
const met = done.filter((r) => r.coverage_met).length
log(`Added ${added} cards; ${met}/${done.length} decks now meet the coverage floor.`)

phase('Verify')
const verify = await agent(
  `Rebuild and report final state. From ${ROOT} run in order:
     node scripts/validate-deck.mjs
     npm run build:deck
     node scripts/audit-card-quality.mjs --limit=0 2>&1 | grep -oE '^\\[S[0-9]\\] [a-z_.]+' | sort | uniq -c | sort -rn
     npm run coverage:audit
   Report verbatim: validate/build pass or fail, the full findings table, and the coverage gate's
   final two lines (overall words/card, and how many decks remain under-covered). Exact errors if
   any command fails. Do NOT edit any file.`,
  { label: 'rebuild + gates', phase: 'Verify', model: 'sonnet', effort: 'low' },
)

return {
  decks: done.length,
  cards_added: added,
  decks_meeting_floor: met,
  still_short: done.filter((r) => !r.coverage_met).map((r) => ({ slug: r.slug, note: r.note })),
  verify_report: verify,
}
