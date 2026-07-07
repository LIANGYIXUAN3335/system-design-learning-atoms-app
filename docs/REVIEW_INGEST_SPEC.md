# Review-ingest pipeline (面试复盘 → atoms cards)

> A fourth content path, alongside AUTHORING / REGEN / ENRICH. It turns each new
> interview debrief into study cards. Detector: `scripts/review-ingest-cron.mjs`.
> Authoring rules: `docs/AUTHORING_SPEC.md` **Mode B**. Judged by the same
> `docs/card-quality-rubric.md`.

## The loop

```
/interview-review <transcript>
   └─ appends a `## Company · Date` section to the 3 card-source files, each with
        <!-- atoms-source id="2026-07-06-amazon" added="2026-07-06" status="new" -->
             ↓
scripts/review-ingest-cron.mjs            (detector — deterministic, no LLM)
   • scans the 3 files for marker blocks
   • PENDING = status="new" AND (file,id) not in review-ingest-ledger.json
   • writes one task file per pending block → scripts/review-ingest-tasks/
   • writes reports/review-ingest-<date>.md
             ↓
card-authoring agent  (AUTHORING_SPEC Mode B — classify each item)
   • knowledge gap  → knowledge deck in the matching <topic>
   • delivery/behavioral gap → interview-drill deck
   • pass the FULL acceptance gate (validate-deck + audit error=0 + judge sampling,
     docs/AUTHORING_SPEC.md §验收门 — same bar as REGEN) — writes CANDIDATES, does not mark done
             ↓
HUMAN ACCEPT gate  ← you review the candidate cards
             ↓
node scripts/review-ingest-cron.mjs --mark-done <id>
   • flips the marker status="new" → "done" in all 3 files
   • records (file,id) in the ledger so it is never reprocessed
             ↓
npm run build:deck && npm run verify
```

## The marker convention (the "split new content" contract)

Every new per-interview `## Company · Date` section in **Interview Action Items.md**,
**Technical_Interview_Questions.md**, **AI_Agent_Interview_Questions.md** carries a
marker on the line directly under the heading:

```
## Amazon · 2026-07-06 · Technical Interview
<!-- atoms-source id="2026-07-06-amazon" added="2026-07-06" status="new" -->
```

- `id` = `<date>-<company-kebab>`, **shared across the 3 files** for one interview (`-r2` suffix if the same company recurs same-day).
- `status` starts `new`; only `--mark-done` flips it to `done`.
- The `interview-review` command emits these automatically (its templates were updated). Existing pre-convention sections are unmarked and are intentionally ignored by the detector — backfill them by hand only if you want cards for an old interview (add a marker).

## Commands

```bash
cd "…/system design learning/atoms-app"
node scripts/review-ingest-cron.mjs              # detect + emit task files + report
node scripts/review-ingest-cron.mjs --dry-run    # detect + report only
node scripts/review-ingest-cron.mjs --json        # machine-readable pending list
node scripts/review-ingest-cron.mjs --list        # show the ledger
node scripts/review-ingest-cron.mjs --mark-done 2026-07-06-amazon   # accept + ledger
node scripts/review-ingest-cron.mjs --dir <path>  # override source dir (testing)
```

## Why human-accept (not auto-publish)

A single noisy debrief can spawn weak cards. The detector and authoring are automated;
merging into the live deck is gated on your review — the same "human accept" principle
the P1 feedback cron uses (see `docs/INDEX.md` → Content Update System). The ledger only
records a block as done once you have accepted its cards, so an un-accepted block re-appears
on the next run.

## Scheduling (durable)

`review-ingest-cron.mjs` is the deterministic detector; run it on whatever schedule
you already use for `content-quality-backfill-cron.mjs`. Two durable options (in-session
CronCreate is NOT durable — it dies with the session):

1. **launchd / system cron** — a plist that runs `node scripts/review-ingest-cron.mjs`
   nightly; if it prints `pending > 0`, it shells a headless authoring pass
   (`claude -p` with the task files) writing candidates, then notifies you.
2. **`/schedule` routine** — a scheduled cloud agent whose prompt is: "run
   review-ingest-cron.mjs; for each pending block author candidate cards per
   docs/AUTHORING_SPEC.md Mode B; pass the full acceptance gate; report for human accept; do NOT mark done."

Default posture: detect nightly, author to candidates, notify — accept by hand.
