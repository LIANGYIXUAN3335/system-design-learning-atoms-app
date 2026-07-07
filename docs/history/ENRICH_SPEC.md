# Atoms enrichment spec — per-option learning notes (for enrichment agents)

> 📍 **体系导航**：三条内容管线之一（只补字段，patch 制，不改题干）。判据权威：`docs/card-quality-rubric.md`；地图：`docs/INDEX.md`。**退役计划**：REGEN 全量重写完成后，本管线使命结束——新任务优先走 `docs/REGEN_FLOW.md`。

You add **per-option learning notes** to existing cards. You do NOT rewrite decks. You only emit a compact **patch file**; a merge script applies it. This protects the 6,000 existing cards from any accidental change.

## Task

For each **choice-format** card (`format` ∈ `mcq` / `multi` / `code`) in your assigned deck file(s), write, index-aligned to that card's `options`:
- `optionMeanings`: Chinese, what this option/approach/statement actually is.
- `optionDirectness`: Chinese, when this option is the better fit. This is a legacy field name; do NOT write a directness verdict.
- `optionScenarioImpacts`: Chinese, what choosing it means in this card's scenario.
- `optionMeanings_en`, `optionScenarioImpacts_en`, `optionDirectness_en`: English counterparts, natural spoken sentences.

**HARD BUDGETS（超出即被 audit 拒收）**: every field you write is ONE sentence, ≤70 chars (CJK counts 1); whole-card reveal total (why + whenOtherWins + all notes) ≤420 chars. If it doesn't fit, write LESS — **an empty field beats filler**. Banned (audit `template_filler`, severity error): "代表一种可以拿来比较的判断路径", "这道题里的候选方案/对比对象/概念判断", "不符合(系统设计的)最佳实践/题目需求", and any sentence sharing a ≥14-char verbatim run with `why` (audit `redundant.why_repeated_in_options`). The full quality bar is `docs/card-quality-rubric.md` — §1.3 gives the exact shape of a good option note (是什么 → 什么场景更合适 → 本场景意味着什么，各一句), and §3 gives the twelve Hello-Interview-style explanation rules.

For **fit/contrast** cards, also emit a `tradeoff` field: ONE line naming both sides of the axis this decision sits on, e.g. `"tradeoff": "读路径延迟 vs 写路径预计算成本"` (audit `tradeoff.not_explicit`).

For **contrast** cards comparing ≥2 named technologies, also emit a `table` (decision matrix, rubric §1.7): `{"headers": ["方案", "读性能", "写扩展", "何时选它"], "rows": [["PostgreSQL", …], ["Cassandra", …]]}` — first column = candidate names, 2-4 discriminating dimension columns (a column with identical values in every row must be swapped, audit `table.non_discriminative`), headers ≤8 chars, cells ≤20-char phrases (audit `table.cell_over_budget`), NO "最佳/推荐" markers (the card's `why` carries the verdict), and the same candidate set keeps identical rows/columns across the whole deck.

Rules for the content of each option's explanation:
- Do **not** write "wrong because correct is B" style explanations. The learner wants to understand every option.
- **Meaning** answers: "What is this option?" For example, "This is an app-level shared cache, not a browser/client cache."
- **Fit context** answers (`optionDirectness`, legacy name): "When would this option be the better fit?" Name the constraint or situation where it belongs.
- **Scenario impact** answers: "If I choose this, what design direction am I committing to in this specific scenario?"
- Do not write "最直接", "不直接", "不够直接", or "直接命中题目的关键约束". The third learning note is not a verdict; it is an applicability boundary.
- For rejected options, explain the scenario where they would win if `whenOtherWins` or the question context supports it.
- Stay **consistent with the card**: never contradict its `answer`, `why`, or `whenOtherWins`. Base your explanations on the card's own `q`, `scenario`, `options`, `answer`, `why`, `whenOtherWins` — you do not need the source article.
- Paraphrase; keep each field to roughly one sentence.
- If the card itself is not self-contained, mark it for rewrite rather than papering over the issue. Bad signs: "this layer", "the article", raw benchmark/scale numbers as the answer, impossible distractors, or unexplained jargon.
- If a number appears, explain the design consequence. Do not merely restate that one numeric option is correct.
- If a technical term appears in an option, explain the term in plain language before comparing it with the best answer.

Do **NOT** touch `cloze` or `chain` cards (they have no options). Skip them.

## Output — a patch file (do not edit deck files)

Write ONE JSON file per deck to: `scripts/enrich-patches/<track>__<deck-filename>` — **track-qualified** to avoid cross-track filename collisions (e.g. `system-design__core-concepts_caching.json`, `low-level-design__in-a-hurry_delivery.json`). The `<track>` is the deck's content subfolder.

Shape — an object keyed by card `id`, only for the choice cards you enriched:

```json
{
  "sd-core-concepts-caching-002": {
    "optionMeanings": ["……这个选项是什么……", "……", "……", "……"],
    "optionDirectness": ["……什么场景更合适……", "……", "……", "……"],
    "optionScenarioImpacts": ["……放到当前场景意味着什么……", "……", "……", "……"],
    "optionMeanings_en": ["… what this option is …", "…", "…", "…"],
    "optionDirectness_en": ["… when this option fits better …", "…", "…", "…"],
    "optionScenarioImpacts_en": ["… what it means in this scenario …", "…", "…", "…"],
    "tradeoff": "读路径延迟 vs 写路径预计算成本"
  }
}
```

- Each array's length MUST equal that card's `options` length, in the same order as authored.
- Include only `mcq`/`multi`/`code` cards. Omit cloze/chain.
- `optionExplanations` / `optionExplanations_en` are legacy-compatible fields. Prefer the three richer fields above for new work.

## Validate your own work

After writing a patch, sanity-check it parses and every entry's arrays match the card's option count. The merge + full schema check is run centrally with:
```bash
cd "/Users/yixuanliang/interview/Job_Search/system design learning/atoms-app"
node scripts/apply-enrich.mjs        # merges patches into decks, then validates
```
Report: which decks you patched and how many cards each.
