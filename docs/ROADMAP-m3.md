# Atoms — M3 Spec

> Design doc · "Atoms" · status: DRAFT · author: Yixuan (spec drafted with Fable) · date: 2026-07-02
>
> **How to read** — English body is the substance; each section opens with a Chinese `> **速读**` line so you can skim in ~2 min. This spec assumes M1 (core drill loop) and M2/M2a (tracks · streak · goal ring · planner) as built, and the M2 spec (`atoms-m2-spec.md`) as the baseline it amends.

---

## 0. Context & scope

> **速读** ｜ 内容量已达标：122 篇全覆盖、6,059 张校验通过的卡片。M3 不再堆内容，转向五件事：**(P0) 让它真跑起来**、**(P0) rubric-driven content quality backfill cron**（每次 quality rubric 更新后，周期扫描存量卡并生成修复批次）、**(P0) 版本更新不丢学习状态**、**(P1) feedback-driven content update cron**（以后接入用户 feedback/API 后再做）、**(P1) 掌握度洞察 / 按题目浏览 / 跟读体验**。明确**砍掉难度分级**。并**明确推翻 M2 §9 对"图"的降级**——架构/数据流图现在是 P0。

M2 was about the motivation/scheduling scaffolding. M1 was the drill loop. Content generation (the offline authoring push) then produced **6,059 validated cards across all 122 Hello Interview articles** (system-design 3,763 · ai-coding 1,173 · llm-sd 389 · low-level-design 734). Volume is no longer the constraint.

M3's thesis: **the product now lives or dies on (a) card quality, (b) whether learner feedback continuously improves the deck, (c) whether updates preserve trust in the learner's history, (d) whether tapping actually transfers to speaking, (e) whether the learner can see and attack their weak spots, and (f) whether 6,000 cards are navigable.** Everything below serves those.

---

## 1. What changed since M2 (reconciliation — read this first)

> **速读** ｜ 四处和 M2 的差异，先对齐：①架构/数据流图从"永不作为目标"升为 P0（仅限结构图，仍不做位图）；②难度分级/课程顺序——**砍掉**，用户明确不需要；③内容维护拆成两级：**P0 rubric-driven backfill cron** 先按不断更新的 quality rubric 修存量卡，**P1 feedback-driven cron** 等接入 feedback/API 后再做；④技术版本更新和内容更新分流：技术更新手动控版本，内容更新可低成本周期跑。

1. **Diagrams: promoted, reversing M2 §9.** M2 §9 declared visual atoms "deferred · never a goal." M3 **overrides that for structural diagrams**: architecture and data-flow diagrams on problem-breakdown and deep-dive cards are now **P0**, because for system design specifically a picture of the request path / component layout carries load that prose can't. Scope of the reversal is narrow: **Mermaid structural diagrams only (flowchart / sequence / ER), still no raster/photo generation.**
2. **Difficulty & curriculum ordering: CUT.** Considered and explicitly dropped by the user. New cards keep being introduced in deck order (M1 behavior). No `difficulty` field, no prerequisite graph. (Recorded so it doesn't creep back in.)
3. **Rubric-driven backfill cron: promoted to P0.** The immediate content problem is not lack of feedback plumbing; it is that the existing 6k-card corpus must keep being re-audited as the quality rubric improves. M3a therefore builds a recurring backfill job that reads the latest `docs/card-quality-rubric.md`, finds known quality gaps, and produces repair batches. Feedback-driven updates are still important, but they move to P1 because API/feedback integration is not the current bottleneck.
4. **Technical updates and content updates are split.** App/schema/migration work should remain a manual versioned engineering flow, preferably handled by a stronger model/person. Content updates are safer to batch through a cron job with cheaper models, because they produce candidates and reports first, not auto-accepted deck mutations.

---

## 2. Design principles (inherit M2's; add two)

> **速读** ｜ 沿用 M2 原则，加两条：**内容即产品**（质量 pass 优先级最高）；**练习要指向"说得出"**（不只是点对）。

- Inherit all M2 principles (stickiness first, local-first, scheduling is the retention engine).
- **Content is the product.** With the loop and scaffolding built, the highest-leverage work is per-card quality, not new screens.
- **Content improvement should be continuous.** The quality rubric will keep changing as live drilling reveals new failure modes; the corpus should be re-audited by a recurring backfill job rather than fixed once by hand. User feedback becomes a second recurring input in P1.
- **Use model quality where risk lives.** Strong models are reserved for app code, migrations, answer changes, and source-dependent technical correctness. Cheaper models can triage feedback, summarize repeated issues, and draft low-risk enrichment candidates under strict gates.
- **Optimize for spoken transfer.** A card is "learned" when you can *say* the justification, not just tap the right option. Features should push toward articulation.

---

## 3. F1 (P0) — Ship the corpus

> **速读** ｜ 6000 张还躺在磁盘上没进 app。这一步：build-deck 合并成 bundle → App.tsx 指向它 → selftest 扩到校验整个 bundle。小活，但不做则后面全是空谈。

The 6,059 cards exist as per-article JSON under `src/content/<track>/` but `App.tsx` still imports only the 34-card seed. Nothing else in M3 matters until they load.

- **Build:** `scripts/build-deck.mjs` (already merges seed + all track dirs, injects `track:*` tags) → `src/content/deck.bundle.json`.
- **Wire:** switch `App.tsx` import from `./src/content/cards.json` to `./src/content/deck.bundle.json`. Keep `cards.json` untouched so `selftest.ts`'s 34-card assertions still pass.
- **Guard:** extend `selftest` (or a new `validate-bundle`) to assert the bundle: unique ids, every card schema-valid, every card carries ≥1 tag and a `track:*` tag (or lives in the `all` view).
- **Sanity for scale:** confirm the daily queue + FSRS behave with ~6k cards and `NEW_PER_DAY` pacing (introduce-in-order means the user won't be flooded).
- **Done when:** app boots on the full bundle, a session drills real system-design cards, selftest green.

### 3.1 Drill-loop polish from live use（added 2026-07-04）

> **速读** ｜ 实刷时两个 P0 体验问题：① session 里必须有明确回主页按钮，并显示当前刷题进度；②"待复习"卡今天答过后，无论点"忘了 / 模糊 / 记得"，都应从今天的待复习里消失，下一次最早明天再出现。

- **Return-to-home affordance:** every study/review session has a visible "主页 / 返回主页" action in the top bar. It exits the session without losing already-recorded answers, refreshes Today stats, and makes the user feel they are not trapped in the drill loop.
- **In-session progress:** the session header shows current position and remaining work, e.g. `第 12 / 40 张 · 已答 11 · 剩余 29`, plus the existing progress bar. The denominator may grow only if a scoped sweep appends cards that were not already in the session queue.
- **Daily completion semantics for reviews:** once a card is graded today, it is done for today. Even `Again / 忘了` should not reappear in today's "待复习" count or be re-appended by the mid-session sweep; the earliest next exposure is tomorrow. This deliberately overrides short same-day relearning steps because the product promise here is daily review debt clearing, not Anki-style minute loops.
- **Implementation rule:** after applying FSRS, clamp any due timestamp that still falls on or before today's local date to tomorrow's local day; the mid-session due sweep must exclude all ids already present in the current queue, especially the just-answered card.
- **Done when:** after grading a due card with any of the three self-grade buttons, Today's due count drops and the card does not appear again in the same session; selftest covers this behavior.

### 3.2 Deadline-aware coverage scheduling（added 2026-07-06）

> **速读** ｜ 几千道题 + 固定面试日期下,朴素 SRS 会被复习债挤死覆盖率——用户想稳,几乎每题都点"模糊",于是**答对的题也被排到明天,永远刷不到新题**,到最后一天还剩几千道。解法两层:①**对错定"地板"**——答对的卡即使点"模糊"也不会明天回来,信心只在地板之上微调,只有答错 / 看答案才允许次日重现;②**覆盖优先的冲刺排期**——一旦设了面试日期就**自动进入**,按 `剩余卡数 ÷ 剩余天数` 配速先把所有题见一遍,复习设每日上限不挤占新题,最后 N 天翻转成"打薄弱点"。地板长度按 deadline 自动缩放,不写死。

**The failure mode.** FSRS optimizes long-term retention with minimum reviews; it is not built for "cover a very large deck before a hard deadline." With ~6k cards and an interview date, two things break: (a) the learner, wanting to be safe, marks almost every card `模糊`, so even correctly-answered cards are treated as shaky and re-scheduled to tomorrow; (b) the review backlog then compounds and starves new-card intake, so the learner never reaches breadth and, on the last day, still faces thousands of cards. The scheduler must be driven by **objective correctness first** (not the learner's self-rated confidence) and must be **deadline-aware**.

**Two independent signals per answer.** Every graded card carries (1) **objective correctness** (`wasCorrect` — did they pick the right option), which the app already knows, and (2) **subjective confidence** (`忘了 / 模糊 / 记得`). Today `toFsrsRating(g, wasCorrect, usedIdk)` blends them, so a `模糊` on a correct card still schedules it soon. M3 separates them: **correctness sets the floor; confidence only fine-tunes above it.**

#### ① Correctness-gated interval floor
- **A correctly-answered card gets a minimum interval floor and cannot return tomorrow, even if graded `模糊`.** Confidence modulates only within/above the floor:
  - correct + `记得` → FSRS-natural interval (may be 5–10+ days).
  - correct + `模糊` → the floor.
  - correct + `忘了` ("I guessed / didn't really know") → a shorter floor, so the learner keeps an honest "I don't actually know this" escape hatch.
- **Wrong answer, or `看答案 / idk`, is the only path that may return next-day** — that is a real retrieval gap.
- This is a natural extension of §3.1's "graded today → not until tomorrow" clamp: for correct cards the clamp grows from "tomorrow" to "floor."
- **The floor length auto-scales to the deadline** (see ②) — it is *not* a fixed 4/5 days.

#### ② Coverage-first cram scheduling (auto-activates on a target date)
The app already stores an interview **`targetDate`**. Treat the presence of a target date as the signal that the learner is cramming — **no separate manual toggle**:
- **With a target date → deadline / coverage mode** (below).
- **Without a target date → today's default FSRS long-term-retention behavior** (unchanged).

In deadline mode:
- **Coverage pacing.** Pace new-card introduction by `remaining unseen cards ÷ remaining days` (the planner's `newPerDay` already does a version of this) so the whole deck is *seen once* before the deadline, instead of letting reviews crowd out new cards.
- **Deadline-scaled floor.** The correct-card floor from ① stretches with `cards left ÷ days left`: many cards / few days → longer floors (protect breadth); few cards / more days → shorter floors (more reinforcement). Concretely, floor ≈ the coverage cadence, clamped to a sane range (e.g. 2–14 days).
- **Review cap.** Reviews may not consume the whole session; reserve a guaranteed share for new cards so new-card throughput never stalls.
- **Final-stretch flip.** In the last N days (deadline-scaled), switch from breadth to depth: stop introducing new cards and re-drill the **weak set** — cards ever answered wrong, marked `忘了/模糊`, or flagged — reusing F4 mastery / F6 weak-card recap. By then everything has been seen; the job is to shore up gaps before the interview.

#### Trade-off (recorded)
This deliberately trades depth for breadth, which is the right call for interview cram ("seen recently + got it right" beats perfect recall of a subset). The risk: a lucky-guess-then-`模糊` card floats out and is never solidified — mitigated because (a) `忘了` on a correct card uses the short floor, and (b) the final-stretch weak sweep re-surfaces every wrong/fuzzy card near the deadline. Because deadline mode is gated on `targetDate`, a learner who wants pure long-term retention simply leaves the date unset.

#### Implementation pointers
- Grade mapping: `src/logic/grading.ts` `toFsrsRating(g, wasCorrect, usedIdk)` → make correctness set the floor tier.
- Floor clamp: `src/logic/srs.ts` `applyReview` → generalize the existing "clamp to tomorrow" into "clamp to `floor(daysLeft, cardsLeft)`".
- Pacing / mode gate: planner + `targetDate` + `newPerDay`; deadline mode is on iff `targetDate` is set.
- Final-stretch weak set: reuse F4 (§6) mastery + F6 (§8) weak-card recap.
- **Done when:** with a target date set and a large deck, a correctly-answered card marked `模糊` does not reappear the next day (it waits the deadline-scaled floor); daily review load stays bounded so new cards keep flowing; the last-N-days session pulls from the weak set; selftest covers the correct-vs-wrong floor logic and the deadline scaling.
- **Status (2026-07-06, implemented on `main`, not yet built into an APK):**
  - Phase 1 (`d45d092`) — `minIntervalDays(self, wasCorrect, usedIdk, floor)` sets the correctness-gated floor; `applyReview` clamps due to it. Wrong/idk → 1 day; correct+忘了 → 2; correct+模糊 → floor; correct+记得 → FSRS-natural.
  - Phase 2 (`6030d64`) — `deadlineFloorDays(newPerDay) = clamp(round(4 × newPerDay / 100), 2, 14)`; App feeds it the plan's `newPerDay` → SessionScreen. Recommended pace / no date ⇒ 4.
  - Phase 3 (`6030d64`) — `FINAL_STRETCH_DAYS = 3`; `isFinalStretch(daysLeft)`; in the final stretch the "全部" view sets newPerDay = 0, floor = 1, and builds `buildWeakSweepQueue` (seen-but-not-mastered, weakest first). Today shows "冲刺收尾：暂停新卡，集中刷未掌握的弱卡".
  - Weak set = not-mastered proxy (Review + stability ≥ 7d = mastered). Flag-based weak signals deferred.

---

## 4. F2 (P0) — Rubric-driven content quality backfill cron

> **速读** ｜ 这是 M3a 的核心 P0：做一个 **quality rubric 驱动的 backfill cron**。每次 `card-quality-rubric.md` 更新后，它都能周期扫描存量 6000 张卡，找出缺 context、缺英文题干/场景、术语未解释、选项拆解弱、长难句、缺图/表/代码等问题，并生成可验证的修复批次。四条内容线：①**题目标题/q 必须自带项目背景和术语落点，并配 `q_en` / `scenario_en` 英文小字**；②**每个选项都要讲清楚"它是什么 / 在什么场景更合适 / 在本场景意味着什么"**；③给 problem-breakdowns / deep-dives 大量补**架构图/数据流图**（Mermaid）；④把 `why`、`why_en`、选项解析改成**短句、好懂、适合跟读背诵**。

This is the **P0 content cron**. It is **rubric-driven**, not feedback-driven: the trigger is a new or changed quality rule, a scheduled audit, or a manually requested backfill batch. It does not wait for API/feedback integration because the failure modes are already known from live drilling: missing context, missing `q_en` / `scenario_en`, weak option teaching, long explanations, and not enough structural diagrams. The P1 feedback cron in F7 is a later second input, not the prerequisite for this work.

### 4.0 Backfill cron shape

- **First implementation:** local CLI, not a cloud service.
- **Suggested command:** `node scripts/content-quality-backfill-cron.mjs --rubric docs/card-quality-rubric.md --dry-run`.
- **Trigger semantics (rubric-version-driven, not blind-nightly):** the rubric carries a `version:` line; the cron runs nightly but **no-ops unless the rubric version changed or unaudited cards remain**. During the current intensive week the rubric changes daily, so this behaves as a daily job; once the rubric stabilizes it self-degrades to a free weekly sweep — no manual re-scheduling.
- **Convergence lock (anti-oscillation):** a run ledger (`scripts/backfill-ledger.json`) records per card `{lastPassedRubricVersion, contentHash}`. A card that already passed under the current rubric version is **skipped** — LLM rewrites are non-deterministic; without this lock the same card gets rewritten every night into a slightly different variant, destabilizing what the learner memorizes.
- **Change-level firewall (protects SRS memory anchors):** spaced repetition depends on re-encountering the *same stimulus*. Diff every repaired card: **Level 1** (explanation-side: `why`, option notes, `table`, `diagram`, `termDefinitions`, all `_en` helper lines) ships freely; **Level 2** (stimulus-side: semantic change to `q` / `scenario` / `options` / `answer`, detected via contentHash) is quarantined into a human-confirm list and does NOT auto-ship — a card whose stimulus changed is a new card wearing an old card's FSRS stability.
- **Priority order (impact × severity):** cards the user actually drilled (`review_log`) → cards due within 7 days → audit errors → audit warnings → never-seen inventory. The first ~500 repaired cards should cover ~90% of the daily experience.
- **Inputs:** current source decks, latest `docs/card-quality-rubric.md` (+version), `docs/judge-calibration.md`, existing audit output, the run ledger, and small same-deck context.
- **Outputs:** backfill report (cards fixed, audit before/after, Level-2 quarantine list), per-deck repair batches, validation result, and the updated run ledger. Accepted content still passes validation before entering the bundle.
- **Non-goal for P0:** ingesting in-app feedback/API events, accept/reject UI, or a full candidate-review product surface.

### 4.0.1 Daily delivery: OTA, not APK reinstall（决定于 2026-07-03）

- **Content/JS updates ship via EAS Update (OTA):** the nightly pipeline ends with `build:deck` → `verify` green → `eas update`. The phone pulls the new bundle on next launch — no rebuild, no reinstall, zero risk to SQLite study state, and **content + rendering code ship as one self-consistent package**（新字段如 `tradeoff`/`fullName`/`q_en` 永远不会遇到不认识它的旧渲染代码）.
- **APK rebuilds are for native changes only**（新原生模块 / app.json 原生配置 / SDK 升级，一月几次）. Iron rules: same `applicationId` + same signing key + incremented versionCode; always **upgrade-install, never uninstall-reinstall**（卸载即清空 SQLite 沙盒 = 学习记录全灭）. EAS Build 免费档 ~30 builds/月也撑不起日更 APK——日更必须走 OTA。
- **Prerequisite:** F6 的最小件——一键 "Export Study State" 备份——在日更管线上线**之前**先落地，作为钢丝下的保险绳。
- **Cloud DB verdict:** 静态语料放云数据库——**否决**：破坏 local-first/离线、引入同步层 + "云内容 × 装机渲染代码"兼容矩阵、且重造 EAS Update 已免费提供的东西。云存储的正确登场时机是 **F7/M2d**：存放**运行时生成的候选卡和推送队列**，而不是静态语料。

The biggest quality gaps the user found: cards often lack enough standalone context and English helper lines; option explanations say only "why wrong" instead of teaching what each option means; some Chinese and English explanations are long, hard to read aloud, and bad for memorization; and structural system-design cards need more diagrams/code/table support. Three workstreams.

### 4.1 Context-rich question titles

- **Rule:** `q` is the learner-facing title because the app has no separate `title` field. It must be understandable from the card list and from the card screen.
- **Good shape:** name the project or component plus the mechanism, then ask the decision or failure mode: "WhatsApp last seen: 只写 last-disconnect 后还剩哪些风险？"
- **Bad shape:** bare internal labels such as "last-disconnect 方案的挑战是什么？", "成功标准是什么？", or "failure modes 有哪些？"
- **Scenario duty:** if a technical term appears in `q`, `scenario` must explain it in one sentence before the question expects reasoning.
- **Bilingual duty:** every card has `q_en`; every card with `scenario` has `scenario_en`. These lines show as small English helper text under the Chinese title/scene.
- **Judge check:** a sampled card fails if the learner must remember the previous card or article section to know what the title refers to.

### 4.2 Per-option decomposition

- **Schema (already supported in `src/types.ts`):** `optionMeanings`, `optionDirectness`, `optionScenarioImpacts`, plus `_en` counterparts, all **index-aligned to `options`**. `optionDirectness` is a legacy field name; new content treats it as **fit context / 适用边界** ("when this option is a better fit"), not a "more direct / less direct" verdict. `optionExplanations` / `_en` remain legacy-compatible display fields, but new work should prefer the three richer fields.
- **Content:** every option teaches three separate things: (1) what this option is, (2) when this option is the better fit, and (3) what choosing it means in this card's scenario. The goal is not "C is wrong" or "C is less direct"; the goal is "C is a real design move, here is the situation where it belongs, and here is what it would imply in this system."
- **Render:** after answering, the right-side / reveal panel should let the user scroll through each option's three-part explanation. Turns a 4-way guess into 4 micro-facts without making the answer area feel cramped.
- **Relationship to `whenOtherWins`:** kept; the three option fields are finer-grained and per-option. They complement the one-card-level tradeoff.
- **Authoring (safe pipeline):** agents **never edit decks** — they emit **patch files** (`scripts/enrich-patches/<deck>.json`, keyed by card id) which `scripts/apply-enrich.mjs` merges in (adds only the enrichment fields, then validates). Cheap model, parallel; explanations derived from the card itself plus small local context. Cards that already have high-quality rich option fields are skipped, never overwritten.
- **Done when:** ≥90% of `mcq`/`multi`/`code` cards carry the three rich option fields in Chinese, and important / jargon-heavy cards also carry the `_en` counterparts.

### 4.3 Architecture / data-flow diagrams

- **Scope:** problem-breakdowns (the high-level design + each marquee deep-dive) and deep-dives (component architecture, request/replication path). Mermaid `flowchart` / `sequenceDiagram` / ER.
- **Target:** every problem-breakdown deck carries **≥3–5** architecture/data-flow diagrams on its structural cards; every deep-dive **≥2–3**. Opportunistic elsewhere.
- **Render:** `MermaidView` already exists (used by seed cards) — no new renderer.
- **Guard:** validate that every `diagram` string parses as Mermaid (a headless mermaid parse in `validate-deck`, or a lint script) so a malformed spec can't ship a blank card.
- **Done when:** targets met and all diagrams parse.

### 4.4 Readable and speakable explanations

- **Problem:** some current `why`, `why_en`, and option notes are technically dense but hard to read, recite, or imitate. Long dependent clauses make the card feel like a paragraph, not a memory atom.
- **Chinese rule:** use short, direct sentences. One sentence should carry one idea. Prefer "先说约束，再说选择，再说代价" over a packed sentence with multiple turns. The wording should sound like the learner's own interview answer, not a technical report: "我会先怀疑距离太远" beats "选择它会把排查带向容量、延迟或性能调优".
- **English rule:** `why_en` is for shadowing aloud, not for literary translation. It should be one plain interview sentence, ideally under 18-22 words. Avoid stacked clauses, semicolons, and abstract nouns when a verb works.
- **Term rule:** if a sentence needs a term like pre-signed URL, fan-out, quorum, GSI, E2EE, or WebRTC, define the term locally before asking the learner to reason with it.
- **Split rule:** if the explanation needs more than two ideas, do not make one long sentence. Move structure into `termDefinitions`, `table`, `diagram`, `codeSample`, or per-option fields.
- **Audit/Judge rule:** sampled QA must include a "can I say this out loud after hearing it once?" check. If not, rewrite for speakability even when the technical claim is correct.

### 4.5 Five explanation shapes from live drilling (2026-07-03 field notes)

> **速读** ｜ 用户实刷总结的案例浓缩成 5 个"解析形状"（机制闭环 / 估算三件套 / 量级锚点 / 形容词落地 / 清单每项挡什么），判据已写入 rubric 1.3-S5、1.4-S4/S5/S5a/S6；**完整 fail/pass 校准样本已拆到 `atoms-app/docs/judge-calibration.md`**——judge 打分把那个小文件整体放进 prompt 即可，不必引用本规划文档。

---

## 5. F3 (deferred) — Listen-and-imitate (TTS naturalness), not spoken grading

> **速读** ｜ 用户定调：口述的"自评 / 录音 / 语音识别"**暂时不做**。真正想要的是**先听、再模仿**。这有两层：内容上，英文句子要短、自然、可跟读；工程上，TTS 要有更自然的声音和语调。

The full spoken-articulation loop (self-grade / record / compare) is **deferred** — the user does not want a scoring/ASR mechanism. The real need is *listen then imitate*: hear a natural English rendering and copy it.

- **The actual problem:** current `why_en` can be too long or translation-like, and `expo-speech` playback can sound robotic — flat prosody, wrong intonation. Either one breaks "listen and imitate."
- **Content prerequisite:** F2 must rewrite hard English restatements into short, plain spoken sentences before TTS tuning. A better voice cannot rescue a sentence that is already hard to say.
- **Investigation (small):** improve English TTS naturalness — tune `expo-speech` voice/rate/pitch, select a higher-quality/enhanced system voice, or evaluate a better on-device TTS. Goal: it should sound like a spoken sentence with natural 抑扬顿挫, not a metronome. This applies to `why_en` and the rich option `_en` fields once F2 lands.
- **Non-goal:** ASR, recording, automatic scoring of the user's speech. Just make the *model's* voice good enough to imitate.

---

## 6. F4 (P1) — Mastery analytics

> **速读** ｜ 用户定调：**掌握度分析至少 P1**。回答"我到底哪块弱"。按 track/topic 出掌握度（从 FSRS stability + 正确率算），浮现薄弱点（最低掌握的 topic、最常忘的卡），一键进针对性复习。尽量从 `review_log`/`srs` 派生，不堆重表。

- **Mastery signal:** per topic/track, derived from FSRS `stability` (retention strength) + recent accuracy in `review_log`. Bucket into e.g. 生疏 / 巩固中 / 掌握.
- **Views:** per-topic mastery rings (extends M2a's per-track goal ring), a **"薄弱点" list** (lowest-mastery topics, most-lapsed cards, cards flagged `hard`), and a one-tap "针对薄弱点复习" that builds a session from them.
- **Transfer signal:** if F3 ships, distinguish "tap-mastered" from "speak-mastered" so mastery reflects articulation, not just recognition.
- **Storage:** derive on read from `review_log` + `srs`; add a cached `mastery` view/table only if the per-topic aggregation is too slow at 6k cards.
- **Done when:** the user can open a screen and immediately see their 3 weakest topics and drill them.

---

## 7. F5 (P1) — Browse / search library

> **速读** ｜ 用户定调：**按题目浏览也是真需求（PE 级）**。6000 张要能翻：track → 文章 → 卡片，支持关键词/标签搜索，面试前能直接跳到某个 problem breakdown。只读浏览 + "现在就刷这副 deck"。

With 6k cards, drilling is not the only access pattern — pre-interview cram and topic lookup need a **library**.

- **Structure:** track → article/deck → cards. Each deck shows its card count and a "现在刷这副" action (a filtered session).
- **Search:** by keyword (q/why text) and by tag (`caching`, `hot-key`, a specific problem).
- **Read mode:** browse cards without it counting as an SRS review (looking ≠ retrieval); a separate explicit "study now" starts a graded session.
- **Done when:** the user can, in <10s, find and open "Dropbox" or all "consistency" cards before an interview.

---

## 8. F6 (P0 before standalone updates) — Update-safe progress & weak-card recap

> **速读** ｜ 用户信任点：软件更新、deck 更新、APK 重装式升级之后，原来的进度、模糊/忘了、反馈、术语标记、自建路径都不能凭空消失。内容在 bundle，状态在 SQLite；解法是稳定 app 身份 + 稳定 card id + deck manifest + 启动时调和 + 弱卡 snapshot + 可导出备份。

The app is local-first. That is good for offline use, but it means the update story must be explicit. Losing progress after an app/deck update would make the product feel unsafe.

### 8.1 Invariants

- **App identity is stable.** Do not change `slug`, iOS bundle identifier, Android package name, or signing key for the same app line. OS-level app updates preserve the app sandbox only when the app identity remains the same.
- **SQLite is the mutable-state source of truth.** `srs`, `review_log`, `feedback`, `settings`, and user `tracks` live locally and must not be rebuilt from the deck.
- **`Card.id` is a durable foreign key.** A card may be rewritten for quality, but its `id` must stay stable. Changing an id is a data migration, not a content edit.
- **Deck content is replaceable; learning state is not.** A new `deck.bundle.json` can arrive, but it must be reconciled against existing local state.

### 8.2 Deck update protocol

- `build:deck` should emit a lightweight manifest with:
  - `deckVersion` / build timestamp.
  - `contentHashById` for detecting changed cards.
  - `aliases` for intentional id moves, e.g. `{ "old-id": "new-id" }`.
  - `retiredCards` for deleted cards with no replacement.
- On app startup, run a non-destructive reconciliation:
  - same `cardId` exists in the new bundle → keep SRS / feedback / review history.
  - `cardId` has an alias → migrate or map state to the new id, and record the alias.
  - `cardId` is retired → keep the state as archived; do not delete it.
  - new card id → starts with no SRS state.
- Reconciliation must be idempotent. Running it twice should not duplicate logs or reset schedules.

### 8.3 Weak-card recap after updates

- Add a "复盘 / 薄弱卡" source that survives deck changes. It pulls from:
  - `srs` cards with low stability, relearning state, or near due dates.
  - `review_log` rows with `forgot`, `fuzzy`, wrong answer, or `usedIdk`.
  - `feedback` rows with flags like `term`, `hard`, `more`, or `wrong`.
- If the card still exists in the current bundle, recap uses the updated card content.
- If the card was retired or replaced, recap still shows it via a local snapshot and labels it "已归档 / 已替换".
- Store a lightweight `card_snapshots` row the first time a card is reviewed or receives feedback: `cardId`, `contentHash`, `q`, `scenario`, `options`, `answer`, `why`, `category`, `savedAt`. This is not a second deck; it is a fallback so weak-card history remains readable.

### 8.4 Backup / restore

- Add an explicit "Export Study State" action before risky migrations or phone changes. It exports SRS state, review log, feedback, settings, user tracks, aliases, and snapshots.
- Add an import path with merge semantics:
  - keep the newer review logs;
  - merge feedback by `updatedAt`;
  - keep the stronger SRS state unless the imported row is newer;
  - never overwrite deck content from the study-state backup.
- Cloud sync is a later option. M3 only needs local export/import plus update-safe migrations.

### 8.5 Acceptance criteria

- Updating via EAS Update or installing a newer APK with the same app identity preserves SQLite state.
- A deck update that rewrites card text but keeps ids preserves all progress.
- A deck update that deletes/replaces a weak card still lets the user recap it from snapshots.
- A simulated old database can be upgraded in tests without losing `srs`, `review_log`, `feedback`, settings, or custom tracks.
- The user can open one screen after an update and see "最近模糊/忘记/标记过的卡".

---

## 9. F7 (P1) — Feedback-driven content update cron: feedback → triage → candidates

> **速读** ｜ 这是 P1，不是 M3a 当前 P0。等接入 feedback/API 后，用户在刷题时写 feedback/标记术语/点"可能错误" → cron 定期导出和整理 → 低成本 triage agent 聚类、忽略低信号项、路由到 REGEN / ENRICH / AUTHORING → 生成 candidate patch/new cards → 质量门 → 人工 accept 后才入库。当前 P0 先做 F2：rubric-driven backfill cron，把存量卡按不断更新的 quality rubric 修好。

The old M2c/M2d loop becomes a later local-first content maintenance pipeline. It is intentionally different from app-version engineering: code, migrations, and release packaging stay manual and high-trust; card updates are batched candidates with human review. F7 should reuse F2's rubric, reporting, model-tier policy, and validation gates, but it is not needed before the P0 backfill cron.

### 9.1 Inputs

- **Primary input:** existing `feedback` table plus `buildFeedbackExport` output. Feedback includes flags, unclear term, free-form note, grade, and source card id.
- **Context input:** source card JSON, same-deck neighbors, same-tag cards, current `docs/card-quality-rubric.md`, and `docs/feedback-triage-rubric.md`.
- **Do not send:** the whole 6k-card deck, private study state unrelated to the feedback, or screenshots/audio unless explicitly attached.

### 9.2 Cron job shape

- **First implementation:** local CLI, not a cloud service.
- **Suggested command:** `node scripts/feedback-content-update-cron.mjs --since last-run --dry-run`.
- **Schedule:** daily lightweight triage or weekly deeper batch via macOS `launchd` / cron.
- **Default mode:** `--dry-run`. It writes reports and candidates but does not mutate source decks.
- **State:** keep a run ledger under `content-feedback/runs/` with timestamp, input hash, model tier, candidates produced, validation result, and accept/reject status.

### 9.3 Triage and routing

- **Ignore / aggregate only:** low-signal feedback such as "too easy" with no note, vague "不懂" with no term/context, duplicate feedback already covered by an open candidate, or requests outside scope (raster images, curriculum difficulty labels).
- **Route to REGEN:** missing context, wrong answer, confusing title, bad explanation, duplicate option explanations, answer-key risk, or anything that changes `q` / `options` / `answer` / core `why`.
- **Route to ENRICH:** term definitions, comparison tables, Mermaid diagrams, code samples, option decomposition, short-sentence cleanup, and other additions that do not change the core judgment.
- **Route to AUTHORING:** user asks for a new concept/theme, repeated feedback reveals a missing prerequisite, or a source card needs sibling cards rather than a rewrite.
- **Escalate to strong model / human:** answer changes, source-grounded factual claims, protocol/database internals, numbers/SLOs, security/payment claims, or anything the cheap triage model marks as uncertain.

The routing rule lives in `atoms-app/docs/feedback-triage-rubric.md`; the cron job must load it before planning work.

### 9.4 Model-tier policy

- **Cheap model OK:** dedupe feedback, cluster repeated complaints, summarize user pain, draft low-risk ENRICH candidates, and produce reports.
- **Strong model / Fable preferred:** app code, migrations, release/update safety, REGEN cards that may change the answer, source-dependent technical correctness, and QA of high-risk generated content.
- **No auto-accept by model tier.** Even cheap low-risk candidates and strong-model candidates enter the same human accept queue.

### 9.5 Candidate format and accept loop

- **Candidate first:** generation emits `patch_existing_card` or `new_cards` candidates, not direct deck mutations. Candidates show source card, user feedback, route, rationale, diff, risk labels, model tier, and accept/edit/reject controls.
- **Provenance:** accepted new cards use `origin: "ai"`, `generatedBy: "feedback"`, `sourceCardId`, `createdAt`, and remain `reviewed: false` until a human accepts them.
- **Quality bar:** generated cards must meet §4: standalone scenario, three-part option decomposition, short speakable `why_en`, local term definitions, and diagrams/tables/code where they carry the mental model.
- **Cost bar:** default batch, small context, prompt caching by `sourceCardId + feedback hash`, text/Mermaid/table/codeSample only, no raster images.

### 9.6 Quality gates

Before a candidate can be accepted into source JSON:

```bash
node scripts/validate-deck.mjs src/content/<track>/<deck>.json
node scripts/audit-card-quality.mjs src/content/<track>/<deck>.json --limit=0
npm run build:deck
npm run verify
```

For higher-risk batches, add sampled judge QA using `docs/judge-calibration.md`. Any accepted batch must produce a short report: feedback items processed, ignored, routed, candidates accepted/rejected, validation result, and remaining human questions.

---

## 10. F8 (BUILT 2026-07-06) — Review-ingest: 面试复盘 → cards

> **速读** ｜ 每次 `/interview-review` 后，3 个复盘文件各追加一个带 marker 的 `## Company · Date` 块；`review-ingest-cron.mjs` 检测 `status="new"` 且不在 ledger 的块 → 出 task 文件 → 交给 AUTHORING **Mode B**（知识 gap 进对应 track，行为 gap 进新 `interview-drill` track）→ 人工 accept 后 `--mark-done` 翻 marker + 记 ledger。是 F7 的姊妹：同样 candidate + human-accept，但输入是面试复盘而非 feedback。规范：`docs/REVIEW_INGEST_SPEC.md`。

区别于 F2（按 rubric 修存量卡）和 F7（feedback 驱动）：F8 的输入是**每次面试复盘新产生的内容**，让每场面试自动转成可复盘的卡片。它复用 F2/F7 的 rubric、report、验证门与 candidate/accept 循环。首批（agentic 集群 + 行为临场）66 张卡已按此路径产出并通过验证门。

### 10.1 The split-new-content contract（marker 约定）

- `interview-review` 命令给 3 个 card-source 文件（Interview Action Items / Technical / AI_Agent，**不含** BQ Playbook）的每个新 `## Company · Date` 段加一行：
  `<!-- atoms-source id="<date>-<company>" added="<date>" status="new" -->`
- `id` = 日期 + 公司 kebab，一场面试 3 文件共用（同日同公司加 `-r2`）。`status` 起始 `new`，只有 `--mark-done` 能翻 `done`。
- 检测器只看 marked 块；2026-07-06 前的历史段无 marker、被有意忽略（要补历史卡就手动加 marker，覆盖情况见 `面试复盘/_atoms-coverage-triage.md`）。
- 同时把 `interview-review` 命令的 4 个 OneDrive 路径修正到工作目录，否则 cron 监测不到活跃文件。

### 10.2 Detector（deterministic，不写卡内容）

- `node scripts/review-ingest-cron.mjs`：扫 3 文件的 marker 块 → PENDING = `status="new"` 且 `(file,id)` 不在 `scripts/review-ingest-ledger.json` → 每个 pending 块出一个 task 文件到 `scripts/review-ingest-tasks/`，并写 `reports/review-ingest-<date>.md`。
- flags：`--dry-run`（只报告）、`--json`、`--list`（看 ledger）、`--mark-done <id>`（accept：翻 marker + 记 ledger）、`--dir <path>`（测试）。
- 与 F2/F7 同样：默认 no-op、有 run ledger、可 dry-run；不写卡内容，authoring 交给子代理。detect→mark-done→re-detect 已用 fixture 测通。

### 10.3 Classify + author（AUTHORING Mode B）

- 每个 action item 先分类：**知识 gap** → 对应 `<topic>` 知识卡（Mode A 规则），需要深度先 scrape 权威文档加进 `atlas_page_scraper/urls.txt`；**行为/临场 gap** → `interview-drill` deck（fit = 情境→动作、cloze/fact = 记忆、chain = 框架）。
- 造卡是 candidate，不直接入库；过 `validate-deck` + `audit` + `build:deck` + `verify` 四门；高风险抽 judge（`docs/judge-calibration.md`）。

### 10.4 Human-accept gate

- 一场嘈杂的复盘可能造出弱卡；检测与造卡自动，合库靠人工 accept——与 F7 同一原则。ledger 只在 accept 后记 done，未 accept 的块下次仍会被检测到。

### 10.5 Status & next

- **已建并验证**：命令 marker 化 + 路径修正；检测器（已测）；AUTHORING **Mode A/B**（`docs/AUTHORING_SPEC.md` 加了 behavioral-card 段）；新 `interview-drill`（面试临场）track（`build-deck.mjs` + `tracks.json`，id abbr `idr`）；首批 66 张卡。
- **未定**：durable 调度——in-session CronCreate 是 session-only，需 macOS `launchd` 或 `/schedule` routine 每晚跑 detect + 造 candidate + 通知；默认先 on-demand，跑通一场真实复盘后再提升。

---

## 11. Explicitly out of scope / cut

> **速读** ｜ 明确不做：难度分级/课程顺序（用户砍）、位图生成、自动语音评分（ASR）、多用户/社交。

- **Difficulty levels & curriculum ordering** — cut by user.
- **Raster/photo image generation** — never (Mermaid text specs only).
- **ASR / automatic spoken-answer scoring** — self-assessment only.
- Social/leaderboards, multi-user auth (single-user tool).

---

## 12. Data-model / schema changes (concrete)

> **速读** ｜ 用现有 rich option fields；提高 diagram 覆盖（不改 schema）；P0 新增 backfill cron 的 report/patch/run ledger；P1 再加 feedback inbox/candidate review；新增 deck manifest / card snapshots / aliases 保护更新后的学习状态；掌握度尽量派生；口述练习记一个计数/标记。

- `Card`: prefer **`optionMeanings` + `optionDirectness` + `optionScenarioImpacts`** and `_en` counterparts; keep **`optionExplanations` / `_en`** as legacy-compatible render fallbacks. `optionDirectness` keeps its legacy field name but now carries "when this option is a better fit / 适用边界", not a directness verdict. All are index-aligned to `options`.
- Diagrams: raise `diagram` coverage (no schema change); add a Mermaid-parse check to `validate-deck`.
- P0 backfill cron files: `content-backfill/reports/`, `content-backfill/patches/`, and `content-backfill/runs/` for rubric-driven audit reports, generated repair batches, and run ledgers.
- P1 feedback candidates: no new app card schema required; use existing provenance fields (`origin`, `reviewed`, `generatedBy`, `sourceCardId`, `createdAt`) when accepted.
- P1 feedback cron files: `content-feedback/inbox/`, `content-feedback/reports/`, `content-feedback/candidates/`, and `content-feedback/runs/` for exported feedback, triage reports, candidate patches/new cards, and run ledgers.
- F8 review-ingest files: `scripts/review-ingest-ledger.json` (`<file>#<id>` → done), `scripts/review-ingest-tasks/`, `reports/review-ingest-<date>.md`. No new app card schema. New **`interview-drill`** track wired in `tracks.json` + `build-deck.mjs` `DIR_TRACK_TAG`/`DIR_TRACK_ID` (id abbr `idr`). The `<!-- atoms-source … -->` marker lives in the 3 复盘 source files, not the app schema.
- Deck manifest: generated with the bundle; include `deckVersion`, `contentHashById`, `aliases`, and `retiredCards`.
- Local update-safety tables: `card_snapshots(cardId, contentHash, json, savedAt)`, `card_aliases(oldId, newId, createdAt)`, and optionally `migration_log(id, fromVersion, toVersion, appliedAt)`.
- Mastery: derive from `review_log` + `srs`; optional cached aggregate only if needed.
- Spoken practice: a lightweight signal — either a `review_log.mode` value (`tap` | `spoken`) or a small `spoken_log(cardId, ts, selfGrade)`.

---

## 13. Milestones (proposed order)

> **速读** ｜ M3a = P0（上线 + rubric-driven content quality backfill cron）；M3a.5 = 更新安全 + 弱卡 recap（Standalone/手机更新前必须定）；M3b = P1（feedback-driven content update cron + 掌握度 + 浏览）；M3c = TTS/跟读。

- **M3a (P0)** — F1 ship the corpus + **F2 rubric-driven content quality backfill cron**:
  - scan existing 6k-card corpus against the latest quality rubric;
  - produce backfill reports and repair batches for standalone context, bilingual `q_en` / `scenario_en`, rich option decomposition, short speakable explanations, architecture diagrams;
  - rerun whenever the rubric changes, because the user's quality bar will keep evolving.
- **M3a.5 (P0)** — F6 update-safe progress + weak-card recap. Must land before treating standalone mobile updates as safe. App/schema/version updates remain a manual engineering flow.
- **M3b (P1)** — F7 feedback-driven content update cron + F4 mastery analytics + F5 browse/search. Feedback cron waits until API/feedback plumbing is worth connecting; it is important, but not the current blocker.
- **M3c** — F3: improve TTS naturalness (listen-and-imitate). Full spoken-grading/ASR deferred.
- **F8 (BUILT 2026-07-06, out of milestone order)** — review-ingest: 面试复盘 → cards (marker + detector + AUTHORING Mode B + `interview-drill` track). Sibling of F7; landed early because interview debriefs were already producing the source content. Durable scheduling (launchd / `/schedule`) still to set up.

---

## 14. Open questions & risks

> **速读** ｜ ①存量 6000 张补选项拆解/短句/图 = 大工程（用子代理批量，成本可控）；②技术正确性仍要抽样 QA；③Mermaid 必须能渲染（加解析校验）；④版本更新不能丢 SQLite 或让 cardId 状态孤儿化；⑤content update cron 不能直接 auto-accept；⑥低端模型适合 triage/ENRICH，不适合高风险技术判断；⑦掌握度阈值怎么定（先用 FSRS stability 粗分，再调）。

1. **Quality-pass cost.** Adding option decomposition + diagrams + short-sentence rewrites to ~6k cards is a large authoring job → parallel subagents, cheaper model, validate every file. Bounded and scriptable, but not free.
2. **Technical correctness.** Schema-valid does not mean factually correct. Keep sampled QA focused on risky cards: numbers, protocols, infra internals, generated diagrams, and cards with user feedback.
3. **Diagram correctness.** A malformed Mermaid spec renders blank; add a parse check to the validator before shipping any diagram.
4. **Speakability risk.** A card can be technically correct and still bad for memorization if `why_en` is a long, translation-like sentence. Judge samples must include a read-aloud check.
5. **Update-state loss.** Changing app identity, deleting Expo Go, changing package name, or churning card ids can make progress appear lost. Treat app identity and `Card.id` as compatibility contracts.
6. **Orphaned weak cards.** Deleting a bad card improves content but can remove the exact thing the user wanted to recap. Use aliases, retired-card markers, and snapshots rather than destructive deletion from the user's perspective.
7. **Feedback-generation cost creep.** Avoid full-deck context, live per-keystroke calls, and raster/image generation. Batch feedback and keep humans in the accept loop.
8. **Model-tier mismatch.** Cheap models are appropriate for triage and low-risk enrichment, but high-risk technical corrections need stronger model/human review.
9. **Cron runaway.** A scheduled job must default to dry-run, write a ledger, dedupe already-seen feedback, and stop on validation failure.
10. **Mastery metric.** Start with coarse buckets from FSRS `stability` + recent accuracy; tune thresholds against your own felt mastery.
11. **Rich option fields on shuffled options.** M1 shuffles option order per render — option fields are index-aligned to the authored `options`, so the display→original index map (already built for grading) must also remap them. Cheap, but don't miss it.
12. **Review-ingest scheduling not durable.** `review-ingest-cron.mjs` runs on demand today; in-session CronCreate dies with the session, so nightly auto-detection needs macOS `launchd` or a `/schedule` routine. Until then, run it by hand after each `/interview-review`.
13. **Behavioral-card answer cue.** In `interview-drill` fit cards the correct "best move" is naturally more detailed than the wrong moves, so the NBME `answer_cue.longest_option` audit fires often — balance by writing the wrong moves with equal specificity (the real mistakes, fully drawn), not by padding the correct one.
