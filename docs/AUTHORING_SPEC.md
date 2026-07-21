# Atoms card authoring spec (for card-generation agents)

> 📍 **体系导航**：内容管线之一（从文章写全新 deck）。判据权威是 `docs/card-quality-rubric.md`——本文 Hard rules 是其浓缩转述，若两者冲突以 rubric 为准（改标准先改 rubric 再同步这里）。地图：`docs/INDEX.md`。
>
> ⚖️ **验收与 REGEN 同门**：新卡的合格线 = 重写卡的合格线（同一 rubric、同一 `audit error=0` 机检、同一 judge 抽查），见文末「验收门」。

You are authoring spaced-repetition drill cards ("atoms") for a personal **interview-study** app. The subject matter is whatever the user needs to drill for interviews — system design, low-level design, ML/LLM systems, coding, **and interview delivery itself**. Follow this spec exactly. Quality matters: bad distractors or vague explanations make the drill worthless.

## Inputs & outputs

This pipeline authors from **two kinds of source**:

**Mode A — from an article** (Hello Interview / Educative / public docs the user owns or can access):
- **Source**: clean Markdown at `/path/to/interview/workspace/atlas_page_scraper/output/clean/<topic>/<file>.md`. Read the whole article first.
- **Output**: one JSON file per article at `/path/to/interview/workspace/system design learning/atoms-app/src/content/<topic>/<same-stem>.json`. The array is the deck for that article.

**Mode B — from an interview-review action item** (the `面试复盘/` files: `Interview Action Items.md`, `AI_Agent_Interview_Questions.md`, `Technical_Interview_Questions.md`). Each item is a gap the user hit in a real interview.
- **Source**: one delimited review block (see the review-file "split new content" convention). Read the whole block.
- **Classify each item before authoring**:
  - ① **knowledge gap** — a concept / tool / algorithm they didn't know (RAG recall, Temporal, topological sort, XGBoost-vs-DL). Author a normal knowledge deck by Mode A rules into the matching `<topic>`; if depth is missing, first scrape an authoritative doc (add its URL to `atlas_page_scraper/urls.txt`).
  - ② **delivery / behavioral gap** — they knew the material but executed poorly in the room (framing, "why leaving", questions to ask, internal jargon, pacing/AI-perception). Author **behavioral-drill cards** into the `interview-drill` topic (see the dedicated section below).
- **Output**: knowledge → `src/content/<topic>/...`; behavioral → `src/content/interview-drill/<company-or-theme>.json`.

`<topic>` is one of: `system-design`, `low-level-design`, `ml-system-design`, `ai-coding`, `interview-drill`, `interview-review`.

**`interview-drill` vs `interview-review`** — both are delivery-side decks and share the behavioral-card rules below.
- `interview-drill` = one interview's items, or a single cross-company delivery theme, authored as it arrives.
- `interview-review` = the **面试复盘 track**: the consolidated, de-duplicated cross-interview deck built from ALL past debriefs at once (`Interview Action Items.md` + the two question banks + coach-debrief recordings). Its defining constraint is **de-duplication**: a mistake the user repeated across N interviews becomes ONE card that names the recurrence, not N cards. Files are per-theme (`openers-and-narrative`, `bq-stories`, `coding-reflexes`, …), not per-company. abbr `irv`.
  Note: `interview-review` decks also need `options_en` and the full bilingual option-note trio (`optionMeanings`/`optionDirectness`/`optionScenarioImpacts` + `_en`) plus a `tradeoff` field on fit/contrast cards — the audit treats these as required even though the schema block above lists them as optional.

After writing, VALIDATE (see bottom). Do not finish until your files pass.

## Card schema (canonical — from src/types.ts)

```ts
interface Card {
  id: string;            // see id scheme
  format: 'mcq' | 'multi' | 'cloze' | 'chain' | 'code';
  atomType: 'fact' | 'fit' | 'contrast' | 'consequence' | 'number';
  topic: string;         // the <topic> above
  sub: string;           // short kebab sub-topic, e.g. "eviction", "sharding-strategy"
  scenario?: string;     // REQUIRED for fit mcq/code: the concrete requirement being decided, Chinese
  scenario_en?: string;  // English version of scenario, shown as small helper text
  q: string;             // the question (Chinese)
  q_en?: string;         // English version of q, shown as small helper text
  options?: string[];    // mcq/multi/code: 3-4 options
  optionDiagrams?: (string | null)[]; // optional Mermaid specs aligned to options; use when choices are architectures/flows
  optionMeanings?: string[];          // optional Chinese: what each option is
  optionDirectness?: string[];        // optional Chinese: when each option is the better fit (legacy field name)
  optionScenarioImpacts?: string[];   // optional Chinese: what choosing it means in this scenario
  optionMeanings_en?: string[];       // optional English counterparts
  optionScenarioImpacts_en?: string[];
  optionDirectness_en?: string[];
  answer?: number[];     // mcq/code: exactly 1 index; multi: >=1 index; indexes 0-based, in range
  text?: string;         // cloze: contains {{answer}} markers (answer text inside braces)
  text_en?: string;      // English cloze text with matching {{answer}} markers when useful
  steps?: string[];      // chain: the ordered reasoning steps, authored already-shuffled
  answerOrder?: number[];// chain: permutation of 0..steps.length-1 giving the correct order
  acceptAltOrders?: number[][]; // chain: optional other valid orderings
  why: string;           // <=2 sentences, Chinese, shown after answering
  why_en: string;        // ONE English sentence, drives text-to-speech
  whenOtherWins?: string;// fit cards: when the rejected alternative would be the right call
  termDefinitions?: { term: string; fullName?: string; meaning: string; meaningEn?: string }[]; // card-local glossary; fullName REQUIRED for abbreviations ("CRDT" → "Conflict-free Replicated Data Type")
  codeSample?: string;   // optional implementation snippet shown with explanation
  lang?: string;         // code language for codeSample (e.g. "redis", "sql", "python")
  diagram?: string;      // optional Mermaid spec (flowchart/sequenceDiagram/stateDiagram/ER)
  tags?: string[];       // 2-4 tags
}
```

Reference examples already in the repo — open these to copy the exact shape:
- `src/content/cards.json` (34 seed cards, all formats)
- `src/content/system-design/core-concepts_caching.json` (a full authored deck)

## The atom taxonomy (how to fragment an article)

Scan the article for instances of these 5 shapes; each becomes one or more cards:

1. **fact** — a component HAS a property. ("Redis is single-threaded.")
2. **fit** — requirement → deciding property → chosen component, + at least one rejected alternative with a why-not. THE most important type; it trains "why did you pick this". Always leads with a `scenario`.
3. **contrast** — A vs B on ONE named dimension. ("On write scaling, Cassandra > single-primary Postgres.")
4. **consequence** — a choice → its risk → a mitigation. ("Eventual consistency → stale reads → read-your-writes/quorum.")
5. **number** — an order-of-magnitude anchor / rule of thumb. ("Single Postgres ≈ 20k+ simple writes/s.")

For 1-2 marquee decisions per article, also build a **decision chain** (`chain` format): requirement → deciding property → choice → cost → mitigation.

## Question formats — pick the right one

- **mcq** (single answer): best for fit and contrast. 4 options, 3 plausible distractors.
- **multi**: best for fact recall of a set ("which of these are X").
- **cloze**: fact recall (`text: "ACID = {{Atomicity}}, {{Consistency}}, {{Isolation}}, {{Durability}}."`) and reasoning-cloze for fit/consequence (`"We chose Cassandra because the workload is {{write}}-heavy, needs {{horizontal}} scaling, tolerates {{eventual}} consistency."`).
- **chain**: the decision chain. `steps` authored already-shuffled; `answerOrder` is the correct permutation; add `acceptAltOrders` if more than one order is valid (grade dependencies, e.g. requirement before choice, choice before its cost).
- **code**: component-level fit where reading real code is the point (Redis command, SQL DDL, ES query). Put the snippet in `codeSample` + `lang`.

## Hard rules

- **Paraphrase in your own words. Never copy sentences verbatim** (personal-use, paraphrased study material only).
- **Bilingual**: `q`, `scenario`, `why`, `whenOtherWins` in **Chinese**; add `q_en` and `scenario_en` as natural English helper lines shown under the Chinese text; `why_en` is **one natural English sentence** (it is read aloud by TTS). `why` ≤ 2 sentences.
- **English helper lines**: `q_en` and `scenario_en` should be plain interview English, not word-for-word translation. Preserve the same constraints, system name, and technical meaning. If a `scenario` exists, `scenario_en` exists. For cloze cards, add `text_en` only when it can preserve the same blanks without leaking extra information.
- **Question as title**: the app has no separate card title, so `q` is the learner-facing title. It must name the system/component/mechanism enough to stand alone. Do not write bare internal labels such as "last-disconnect 方案" or "成功标准是什么" unless `scenario` first explains the project background and the term in one sentence.
- **fit** mcq/code MUST have a `scenario` and a `whenOtherWins` (the rejected-alternative / when-other-wins line).
- **Vary the correct-answer index** across cards (spread across 0..3). Do not always put it at index 1.
- **cloze** must contain at least one `{{...}}`; the text inside braces is the expected answer.
- **chain**: `answerOrder` MUST be a permutation of `0..steps.length-1` (each index exactly once). ≥2 steps.
- **Visual layer is required for visual concepts.** Use `diagram` (Mermaid) whenever the concept is spatial/temporal/structural: data flow, request lifecycle, write path, replication, sharding, leader/follower, queue/worker, state machine, protocol handshake, component-choice flowchart, or architecture trade-off. For deep-dives and problem-breakdowns, target roughly **15-25%** of cards with a visual atom, plus at least one visual early in the deck that teaches the core mental model.
- Use `table` for contrast cards when the learner needs to compare dimensions (e.g. Postgres vs Cassandra, TCP vs UDP, SSE vs WebSocket).
- Use `optionDiagrams` when the answer choices are architectures, flows, or topologies. It must be the same length as `options`; use `null` for text-only choices. Each non-null value is a Mermaid spec for that option. Keep option diagrams small so A/B/C/D remains scannable.
- For important choice cards, add `optionMeanings`, `optionDirectness`, and `optionScenarioImpacts` so every A/B/C/D option teaches what it is, when it is a better fit, and what choosing it implies in the current scenario. Avoid shallow "wrong because correct is B" wording.
- `optionDirectness` is a legacy field name. New content uses it for fit context / applicability boundary, not a directness verdict. Do not write "最直接", "不直接", "不够直接", or "直接命中题目的关键约束".
- Every card needs `why` AND `why_en`.
- Do NOT use legacy field names: `en`, `other`, `opts`, `prompt`, `answerIndex`.
- Cards must be self-contained. Do not ask "this layer", "the article", "the above design", "this plan", or a bare company fact unless the scenario gives enough context to answer the card in isolation.
- Do not turn article assumptions or benchmark numbers into trivia. If a number matters, ask what design implication follows from that number, or give the number in the scenario and ask for the architectural consequence.
- Distractors should be plausible misconceptions or real alternative designs. Avoid throwaway choices and avoid generic explanations such as "does not fit the requirements".
- **Balance option lengths — the correct option must NOT be the longest.** A detailed right answer next to terse distractors telegraphs itself (the NBME `answer_cue.longest_option` audit flags this). Write each distractor with the same specificity as the correct one (a real, fully-drawn wrong alternative), rather than padding the correct option or trimming it below the distractors. This is the single most common finding when an agent authors a batch.
- For jargon-heavy choice cards, define the term locally in `scenario`, `why`, or per-option fields. A learner should not need the original article open to understand TCP, UDP, WebRTC, DynamoDB, CDC, DLRM, GraphSAGE, GSI, RCU/WCU, fan-out, etc.
- Use `termDefinitions` when the card needs a local glossary entry that the global term detector may not know, especially for product-specific or paper-specific terms.
- Prefer single-best-answer wording for tradeoffs. Many technologies are defensible; the card must say why one option is most direct under the stated constraints, not imply the other technologies are globally wrong.
- **Mechanism/recovery cards must walk the FULL state chain** (rubric 1.4-S4): normal path → failure → intermediate state → recovery action → cost. E.g. Redis Streams: "XREADGROUP 领取 → 未 XACK 留在 PEL → worker 死后 idle 增长 → XCLAIM/XAUTOCLAIM 接管重做 → XACK；代价：可能重复执行，业务要幂等". Never jump from problem to conclusion word ("XCLAIM 接管") while skipping PEL/idle; every term on the chain gets a termDefinitions entry.
- **Estimation/number cards give the trio** (rubric 1.4-S5): the formula ("10 亿注册 × 20% 在线 = 2 亿并发"), the unit's full name ("TPS = Transactions Per Second"), and what the number feeds downstream ("后续服务器数、心跳量的基数"). A number with no formula and no downstream use is trivia. If a number is an SLO/SLA or product target rather than a calculation (for example "<500ms" or "<1 minute"), say that explicitly and test the design path it constrains instead of asking the learner to recall the raw number.
- **Quantitative anchors beat vague adjectives** (rubric 1.4-S5a): if the explanation mentions latency, QPS/TPS, throughput, GB/TB, CPU/memory thresholds, connection counts, object size, or chunk/part size, add a rough explainable anchor when possible: assumption/source → formula → order of magnitude → design consequence. Example: "LA↔NY ≈ 4,000km; fiber ≈ 200,000km/s; one-way lower bound ≈20ms, RTT ≥40ms; real paths are higher, so cross-region synchronous reads cannot be fixed by SQL tuning." Mark operational thresholds like CPU 60-70% as rule of thumb, not law.
- **Ground every adjective** (rubric 1.4-S6): "simpler/faster/cheaper" must point at a concrete interface, operation, or resource — "offset 简单 = 接口只传 offset/limit 两个整数、翻页 offset += limit；cursor 要稳定排序键 + 保存末条 id + 范围查询". An adjective you can't ground gets deleted.
- **Interview voice is mandatory** (rubric 1.4-S7): write explanations as short spoken answers the learner can say back in an interview. One sentence = one idea. Prefer "我会先…因为…但代价是…" over abstract report prose. Do not write template phrases such as "选择它会把排查带向…" or "直接命中题目的关键约束".
- **List/layer cards (multi, security layers, hardening, optimization menus)**: each item's note is one sentence of "what risk it blocks / where it removes pressure" (rubric 1.3-S5) — "read-only filesystem：防止用户代码改依赖、留持久文件", "batch processing：多条写合一次事务，减少 WAL flush，但有缓冲丢失风险". Never a noun translation list.

## Behavioral / interview-delivery cards (`interview-drill` topic)

Delivery gaps — "address a soft rejection head-on instead of ignoring it", "ask 2 substantive questions", "don't say HAC/PRAC out loud", "10-min out-loud warmup to kill the pausing/AI perception", "connect the self-intro to the role they just described" — are NOT system facts, but they ARE drillable recall. Map them onto the SAME schema; the difference is the subject, not the format:

- **`fit` mcq — "situation → best move" (primary format).** `scenario` = the concrete interview moment ("Recruiter says mid-call: 'we're not hiring at that level yet'"). Options = candidate responses, with the RIGHT move as one option and **the real mistakes the user actually made** (from the action-item text) as the distractors. `whenOtherWins` = when a different move is the right call. This trains the decision, not a slogan.
- **`cloze` / `fact` — recall the specific fix / number / phrase.** "The fix for the pausing-perception flag is a {{10}}-minute out-loud warmup answering {{3–4}} questions from memory." Use for a remedy, a set phrase, or a metric target.
- **`chain` — ordered framework.** The steps of a repeatable move (the ML-ranking answer's 5 components; the self-intro "listen → reflect one signal back → bridge to my project" sequence). `steps` authored already-shuffled; `answerOrder` is the correct order.
- **`atomType`**: `fit` for situation→move, `fact` for recall, `consequence` for "if I skip this → what it costs me in the room".
- **Voice**: `why` / `why_en` = the first-person spoken principle the user says back to themselves — name the real failure and the real fix ("先直接 address 软拒绝再继续；假装没听见 = 结束时对方觉得你不匹配"). No invented psychology; the source is the action-item text, paraphrased into a decision the user can rehearse.
- **Scope**: these are recall scaffolds. The real out-loud drilling still lives in the `rewrite-bq` workflow — a card reminds, it does not replace speaking practice. Do not turn a behavioral item into system trivia.
- `sub` = a short theme ("soft-rejection", "questions-to-ask", "self-intro", "pacing"). File naming: `interview-drill/<company>.json` for one interview's items, or `interview-drill/<theme>.json` for cross-company patterns (e.g. `why-leaving`, `questions-to-ask`).

## id scheme (collision-free — derive mechanically)

`id = "<abbr>-<file-stem-dashed>-<NNN>"`, NNN zero-padded to 3 digits, starting 001, per file.
- `<abbr>`: system-design→`sd`, low-level-design→`lld`, ai-coding→`aic`, llm-sd→`llm`, interview-drill→`idr`, interview-review→`irv`.
- ROUTING NOTE: the scraped **ml-system-design** source articles are authored INTO the `llm-sd` output dir, with `topic: "llm-sd"` and abbr `llm` (they seed the llm-sd track). low-level-design source → `low-level-design` dir, `topic: "low-level-design"`, abbr `lld`. ai-coding source → `ai-coding` dir, `topic: "ai-coding"`, abbr `aic`.
- `<file-stem-dashed>`: the source filename without `.md`, with `_` and any non-alphanumeric replaced by `-`.
- Example: `system-design/deep-dives_kafka.md` → ids `sd-deep-dives-kafka-001`, `sd-deep-dives-kafka-002`, …
- Example: `ai-coding/problem-breakdowns_connect-four.md` → `aic-problem-breakdowns-connect-four-001`, …

This guarantees no collisions with other agents.

## Density & coverage

- Cover EVERY section and concept in the article — don't skimp. Target **~50-80 cards** for a dense article (deep-dives, problem-breakdowns), **~30-50** for shorter overview pages. More is fine if the article is rich; never pad with near-duplicate cards.
- Prefer depth: for a problem-breakdown, atomize the requirements, the core entities/API, the high-level design, each deep-dive, and the key numbers/trade-offs.

## 验收门（must pass — 与 REGEN 完全同一标准）

> **写新卡和重写旧卡的验收标准是同一份，没有"先生成、以后重写再达标"这回事。**
> 判据 = `docs/card-quality-rubric.md`（唯一裁判）；机检 = audit error 必须为 0；judge 抽查同 `docs/REGEN_FLOW.md` Step 4。
> schema 通过（validate-deck）只是入场券，不是验收。历史教训：只跑 validate-deck 生成的 deck，
> 曾留下上百条 rubric 违规（最长选项泄漏答案、fit 卡缺 tradeoff、术语无解释），全靠事后 REGEN 补课。

每写完**一个** deck，按顺序全部通过才算完成（全绿再写下一个）：

```bash
cd "/path/to/interview/workspace/system design learning/atoms-app"
# 1. schema 门（入场券）
node scripts/validate-deck.mjs src/content/<topic>/<your-file>.json
# 2. rubric 机检门：error 必须为 0；warning 逐条处理或在报告里给一句不改的理由
node scripts/audit-card-quality.mjs src/content/<topic>/<your-file>.json --limit=0
# 3. bundle + 逻辑 + Mermaid 三道门
npm run build:deck && npm run verify
```

4. **Judge 抽查（同 REGEN Step 4）**：从本 deck 随机抽 10 张（或 ≤10% 取大者），按 REGEN_FLOW 的四项
   （约束决定答案 / 答案泄漏 / 英文口语自然度 / Gate 0 复核）逐卡 pass/fail + 一句理由，输出成表。
   ≥2 张 fail 同一项 → 该项全 deck 系统性返工后重跑机检。

**汇报格式（同 REGEN Step 5）**：每 deck 一段 —— 文件名、卡数、audit `errors 0 / warnings N（残余分类）`、judge 抽查结果表、verify 全绿。
