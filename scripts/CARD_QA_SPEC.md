# Card QA spec

`validate-deck.mjs` checks schema. `audit-card-quality.mjs` checks learning quality heuristics. The quality bar itself (success/failure matrix, length budgets, generation constraints) lives in `docs/card-quality-rubric.md` — this file documents what the audit script can enforce mechanically.

## Rules

### too_long.why / too_long.when_other_wins / too_long.option_note / too_long.reveal_total

- Severity: warn at target, error at hard cap (budgets in rubric §3: why ≤120/170; option note ≤70/110; whenOtherWins ≤140; reveal total ≤420)
- Detect: character counts over budget; `reveal_total` sums why + whenOtherWins + all option-note fields — what a learner actually reads per card.
- Fix: cut to the one decision the card teaches; if it can't fit, split the card.

### redundant.why_repeated_in_options

- Severity: warn
- Detect: any option-note field shares a ≥14-char verbatim run with `why`.
- Fix: option notes must ADD information (the misconception, the when-it-wins condition); never restate `why`.

### template_filler

- Severity: error
- Detect: zero-information filler phrases ("代表一种可以拿来比较的判断路径", "这道题里的候选方案", …).
- Fix: write the actual misconception/consequence, or leave the field empty — an empty field beats filler.

### answer_cue.longest_option

- Severity: warn
- Detect: single-answer choice card whose correct option is >1.9× the average distractor length (and >14 chars longer). Length telegraphs the answer (NBME: options should be of similar length); at last audit 2861 cards hit this.
- Fix: trim the correct option or give distractors comparable detail.

### terms.missing_full_name

- Severity: warn
- Detect: a `termDefinitions` entry whose `term` looks like an abbreviation (2-6 chars, mostly uppercase: CRDT, OT, mTLS, gRPC) but has no `fullName`.
- Fix: add the expansion — `{"term": "CRDT", "fullName": "Conflict-free Replicated Data Type", …}`. The glossary renders "CRDT (Conflict-free Replicated Data Type)：…"; without fullName it degrades to "CRDT (CRDT)". A learner's first question about any abbreviation is what it stands for.
- Implementation note: `ABBREV_RE = /^[a-z]?[A-Z][A-Za-z]{0,4}[A-Z]s?$|^[A-Z]{2,6}s?$/` — this rule has been overwritten twice by concurrent edits to audit-card-quality.mjs; whoever owns the script next, please re-add it (and CRDT/OT/SDP/QUIC in JARGON_RE).

### tradeoff.not_explicit

- Severity: warn
- Detect: fit/contrast choice card with no `tradeoff` field and no both-sides tradeoff language in `why`/`whenOtherWins`.
- Fix: add `tradeoff: "X vs Y"` (one line naming both sides) or name the sacrificed quality inside `why`.

### context.deictic_without_context

- Severity: warn
- Detect: question uses deictic phrases like "this layer", "the article", "the above design", "this system", "this means what", but has no `scenario`.
- Fix: rewrite the stem with the concrete system, component, or code snippet needed to answer.

### number.all_options_numeric

- Severity: warn
- Detect: a choice card asks for a raw number and most options are quantities.
- Fix: give the number as a premise and ask for the design consequence, or include a calculation formula in `why`.

### choice.generic_explanation

- Severity: warn
- Detect: multiple options are explained as "does not fit the requirements", "not best practice", or similarly generic prose.
- Fix: explain the misconception or alternative tradeoff behind each option.

### choice.legacy_only

- Severity: warn
- Detect: choice card has only `optionExplanations`, not `optionMeanings`, `optionScenarioImpacts`, and `optionDirectness`.
- Fix: migrate important fit/contrast/consequence/code cards to the three-field form.

### terms.undefined

- Severity: warn
- Detect: q/options contain dense technical terms but no local explanation or rich option notes.
- Fix: add `termDefinitions` or explain the term in `scenario` / option fields.

### fit.missing_when_other_wins

- Severity: error
- Detect: fit choice card lacks `whenOtherWins`.
- Fix: say when the rejected alternative would become the better design.

### explanation.truncated_or_cross_topic

- Severity: error
- Detect: generated text appears truncated, or a known cross-topic fragment appears.
- Fix: rewrite the whole card explanation and option notes from the card's actual scenario.

## Output

The audit script prints a human-readable review queue by default:

```bash
npm run quality:audit -- --limit=80
```

Use JSON for batching:

```bash
npm run quality:audit -- --json --limit=200
```
