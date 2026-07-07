# Atoms — M2 Spec

> 🗄 **ARCHIVED 2026-07-07** — 历史文档，只作背景与决策依据；文中路径/状态以当时为准。现行结构与标准见 `docs/INDEX.md`。

> Spec for the second build increment · companion to `atoms-design-doc.md` / `atoms-technical-design.md` · builds on Fable's M1 in `atoms-app/` · date: 2026-07-01
>
> **读法**：正文英文（给实现者/Fable 读），每节 `> **速读**` 是中文摘要。给 Fable 用时说：「读 `atoms-m2-spec.md`，先批判审一遍，再按里程碑实现。」

---

## 0. Scope

> **速读** ｜ M2 要加五块：①动机层（每日目标 + 连续天数 + 斩杀）②规划器（面试日期+类型→每天几张新卡）③开放式标签/路径（tag + 并集，可无限扩展 topic）④复盘（模糊/忘了的卡升级复现，直到记住）⑤**生成服务**（反馈→后台队列→联网检索→生成打标签→注入→12h/次日推送）。设置页放：强度预设 + 早晚提醒。可视化表格渲染是低优先"便宜就做"。

M2 turns M1 (a working SRS drill loop) into a **sticky, personalized, self-extending** study product. Five workstreams:

1. **Motivation layer** — daily goal, streak, "斩杀" framing.
2. **Planner** — interview date + type → daily new-card recommendation + track.
3. **Tags & Tracks** — open-ended tagging; a track = union of tagged cards; extensible to any number of topics.
4. **Review / 复盘** — escalate fuzzy/forgot cards until mastered.
5. **Generation service** — feedback → background queue → web-grounded generation → tagged cards injected → delivered by push.

---

## 1. Design principles (govern everything below)

> **速读** ｜ 四条铁律：①**只有一个调度器 = FSRS**，"错题什么时候再出现"交给它，别自己写日历规则。②**学习端本地优先**（离线可刷），**生成端才是后台服务**。③**API key 只在服务器**，app 里永远没有。④标签系统**开放可扩展**，不写死三条路径。

- **One scheduler = FSRS.** When a card reappears is decided per-card by `ts-fsrs`, never by a hand-rolled "redo wrong cards every morning" rule. User preferences about *cadence* map to **reminders + an intensity preset**, not to a second scheduler (see §5).
- **Local-first study, server-side generation.** The drill app (`atoms-app/`) stays fully offline-capable. Only the *generation* loop talks to a backend.
- **The API key lives only on the server.** The app has no Anthropic dependency and no key (M1 already respects this).
- **Tags are open-ended.** No fixed set of tracks in code — the user has downloaded resources across AI coding / classic SD / LLM SD and will add more. Tracks are *saved tag filters*, addable at runtime.

---

## 2. Motivation layer (daily goal · streak · 斩杀)

> **速读** ｜ 数据现成（`review_log` 每条带 day/correct）。加三样：①**每日目标环** 今日 X/Y（Y = 今日到期 + newPerDay）②**连续天数** 🔥 N 天（清空当日队列即 +1，宽容口径）③Done 页改成斩杀框架"本次斩杀 8 · 今日 20/20 · 🔥 连续 6 天"。Session 顶部可显示实时"斩杀 N"。

All computable from the existing `review_log` table — **no new tables needed**.

- **Daily target:** `dailyTarget = dueTodayCount + newPerDay`. Home shows a ring/bar: `todayDistinctAnswered / dailyTarget`. Use **distinct cards answered today** (not raw `review_log` rows — a re-lapsed card answered twice counts once), fixing the M1 over-count noted in review.
- **Streak:** consecutive local days on which the day's due queue was cleared (or ≥1 review when nothing was due — keep it forgiving so a light day doesn't break it). Compute from `SELECT DISTINCT day FROM review_log`.
- **斩杀 framing (copy changes):**
  - Home: goal ring + `🔥 连续 {streak} 天`.
  - Session header (`SessionScreen.tsx`): live `斩杀 {answered}` instead of only `已答 N`.
  - Done (`DoneScreen.tsx`): `本次斩杀 {answered} · 今日 {todayDistinct}/{dailyTarget} · 🔥 连续 {streak} 天`; celebrate when target is hit.
- Optional (nice-to-have): lightweight per-topic mastery ring (mastered/total) as a 闯关 progress; reuse the existing `MASTERED_STABILITY_DAYS` definition.

---

## 3. Planner (每日任务)

> **速读** ｜ 输入：面试日期 D + 面试类型 → 选定 track。输出：`newPerDay = ceil((track原子数 − 已掌握) / (D×0.8))`，超过舒适上限就提示"延期或砍范围"。每日任务 = 今日到期(FSRS) + newPerDay 张新卡，全自动。替换 M1 的 `NEW_PER_DAY` 常量。

- **Inputs:** `targetDate` (interview day) + interview type → selected track(s) (§4).
- **Output:** `newPerDay = clamp( ceil( (N_track − mastered_track) / (D × 0.8) ), 1, COMFORT_MAX )` where `D` = days to interview, `COMFORT_MAX ≈ 20`. If the raw value exceeds `COMFORT_MAX`, surface a warning: *extend the date or narrow the track*.
- **Replaces** the `NEW_PER_DAY` constant in `config.ts` (M1 already flags this as the planner's insertion point).
- The daily queue (`queue.ts buildQueue`) already takes `newPerDay` as an option — wire the planner's value in.

---

## 4. Tags & Tracks (open-ended grouping)

> **速读** ｜ 复用 `Card.tags: string[]`（M1 已有这个可选字段）。**一张卡可带多个 tag**（topic + 能力域）。**track = 一个 tag 过滤器（取并集）**，存成可增删的清单（`tracks` 表 / 或 bundled + 用户自定义）。首页加**路径选择器**；牌堆 = 所选 track 匹配的卡的并集；进度/目标按 track 算。初始三条：AI coding / 经典系统设计 / LLM 系统设计——但结构上**无上限**，用户随时能加。

- **Card side:** reuse `Card.tags: string[]` (already in `types.ts`). Convention: a card carries one `topic:*` tag plus zero-or-more capability tags, e.g. `["topic:databases", "topic:replication", "track:classic-sd"]`. A card **may belong to multiple tracks** (e.g. `quorum` → both classic-sd and llm-infra). The port script / generator sets these.
- **Track = a saved tag filter** (union semantics): `{ id, name, include: string[] /* tags; card matches if it has ANY */, exclude?: string[] }`. Store in a `tracks` table (seeded from a bundled `tracks.json`, user-addable at runtime) — **not hardcoded**.
- **Deck for a session** = union of cards whose tags match the active track's filter. FSRS state is per-card, so switching tracks never loses progress; the daily goal/streak are computed **within the active track**.
- **Seed tracks** (editable): `AI coding` · `Classic system design` · `LLM system design`. The 11 agent cards + database/consistency cards get tagged accordingly; new topics are just new tags.
- **Home:** a track picker (chips or a list). Selecting a track sets the active deck + planner scope.

---

## 5. Settings — the user's 节奏 choice (study rhythm)

> **速读** ｜ 给用户**一个选择：早晚刷 / 每天刷 / 隔天刷**。这一个选择同时定两件事：①**提醒频率**（几时叫你坐下）②**FSRS 强度**（request_retention，决定卡整体多勤回来）。关键：用户的选择是**调 FSRS 的旋钮**，不是另造一个调度器——所以"给了用户选择"和"FSRS 唯一调度器"**不冲突**。

Give the user **one choice — a study rhythm** — that bundles two settings, so it stays simple:

| 用户选 rhythm | 提醒 reminders | FSRS `request_retention` | effect |
|---|---|---|---|
| 早晚刷（冲刺 intensive） | morning + evening (2×/day) | 0.95 | cards recur most often, tightest correction |
| 每天刷（正常 normal） | once daily | 0.90 | balanced (default) |
| 隔天刷（轻松 relaxed） | every other day | 0.85 | cards spaced widest, least time |

- The rhythm is the **input that tunes FSRS** (sets `request_retention` in `srs.ts`) **and** sets the `expo-notifications` schedule. **FSRS still computes each card's timing** — the choice does not replace it. This is precisely how we "give the user a choice" while keeping a single scheduler.
- Reminder times remain individually editable (the table gives the per-preset defaults).
- **Do NOT build** a separate "repeat wrong cards every morning" rule — the rhythm preset + FSRS relearning already deliver exactly that, adaptively.

---

## 6. Review / 复盘 (fuzzy & forgot → repeat until mastered)

> **速读** ｜ "复习进度"= 主要复现用户模糊/忘了的卡，多出现几次直到记住——这**FSRS 已经在做**（错→relearning 快速回来，对→间隔拉长）。M2 只加一层**复盘升级**：一张卡反复错(lapse≥N)或被打「术语看不懂」时，升级呈现（前置卡 / 更细拆解 / 更深解释），并把它送进生成服务(§7)造一张更基础的新卡。再加一个「本周最卡的 N 张」集中复看。

- **Base behavior (already works via FSRS):** fuzzy/forgot cards resurface soon and repeatedly; mastered cards space out. "Repeat until they feel they've got it" = keep grading; stability grows past `MASTERED_STABILITY_DAYS` → it graduates. Surface this as a **per-card familiarity indicator** (learning / young / mastered) so the user *sees* progress.
- **Escalation (new):** when a card is missed repeatedly (`lapses ≥ N`, from FSRS) or flagged `term`/`wrong`, mark it a **weak card** and (a) show extra help inline (its `diagram`, `whenOtherWins`, English restatement read aloud), and (b) enqueue it to the generation service (§7) to spawn a **prerequisite / simpler** card.
- **Weekly 复盘 view (new):** a "本周最卡的 N 张" list (highest lapses / lowest stability) for focused re-study.

---

## 7. Generation service (feedback → web-grounded cards → push)

> **速读** ｜ 这是 M2 最重的一块，也是"个性化定制学习"的核心。链路：app 导出反馈 → 传到**后台服务**入**队列** → worker **联网检索**(web search)拿到最新/权威信息 → 用**结构化输出**生成/修正卡片(含 Mermaid 图) → **打标签 + 记来源** → 注入用户卡库(标为"AI 生成·待确认") → **12h/次日 push** 通知用户 → app 拉取合并。**API key 只在服务器**。分两阶段落地：**2a 先用无服务器的手动闭环验证，2b 再上这套后台服务**。

### 7.1 The loop (target architecture)

```
app                         backend (generation plane, has API key)
───                         ─────────────────────────────────────
导出反馈 JSON ──POST /gen──► enqueue job (gen_jobs: queued)
                                 │  worker picks up
                                 ▼
                            1. web search  (ground on current/authoritative info)
                            2. structured-output generation (Claude, schema-valid cards + Mermaid)
                            3. tag + provenance (track/topic tags, generatedBy=feedback, sourceCardId)
                            4. store as PENDING cards, mark for delivery
                                 │  after ≥12h (or next AM reminder)
                                 ▼
   ◄──push "N 张针对你薄弱点的新卡"── schedule delivery
拉取新卡 ──GET /cards/new──► return pending cards
syncCards 合并入本地库 (标 "AI 生成 · 待确认")
```

### 7.2 Components

- **Intake:** app uploads the `FeedbackExportItem[]` (M1's `buildFeedbackExport` output) + the user's library/track id.
- **Queue:** `gen_jobs(id, userId, payload, status[queued|running|done|failed], attempts, createdAt)`. Start with a DB-backed queue; graduate to SQS/Redis only if volume needs it.
- **Worker (per job):**
  1. For each gap decide the target: unclear `term` → a **prerequisite/definition** card; `wrong` flag → a **corrected** card; `hard` / repeated-lapse → a **simpler decomposition**; weak topic → **more coverage** cards.
  2. **Web retrieval** — Anthropic **`web_search` server tool** to ground on current/authoritative info (needed because system-design facts drift and personalization wants specifics). No separate scraping stack.
  3. **Generate** — a **structured-output** call (`messages.parse` + a Zod/JSON schema for `Card`, model `claude-opus-4-8`), emitting schema-valid cards, including an optional **`diagram` (Mermaid spec)** where visual. **Note:** "图片" = Mermaid/diagram *specs* (text, vector-rendered), **not raster images** — raster/photo generation is out of scope.
  4. **Tag + provenance** — attach `tags` (track/topic), `generatedBy:'feedback'`, `sourceCardId`, `createdAt`, `origin:'ai'`, `reviewed:false`.
  5. **Injection gate** — inject as **pending / "AI 生成 · 待确认"** (content correctness isn't guaranteed; the user confirms or edits). Keeps a human in the loop cheaply.
- **Delivery:** hold ≥12h (or bind to the next morning reminder), then push; app pulls and `syncCards` merges (M1's bundle-vs-state reconciliation already handles new ids arriving).
- **Secrets/cost:** `ANTHROPIC_API_KEY` on the server only. Use the **Batches API** (50% off) for non-urgent jobs and **prompt-cache** the atomization/taxonomy system prefix.

### 7.3 Staging (do this, don't boil the ocean)

- **Phase 2a — no server (recommended first).** Keep the manual loop: export feedback → hand to Claude Code / me → `/atomize` Mode 2 (Claude can web-search during generation) → new cards JSON → drop into `src/content/cards.json` → app merges. **Zero infra, zero key management.** Validates the whole personalization loop before building backend.
- **Phase 2b — the service above.** Build the queue + worker + push once 2a proves the loop is worth automating. This is where the key, web retrieval, and delivery become a real backend.

---

## 8. Data model changes (concrete, vs current schema)

> **速读** ｜ 卡片：用起 `tags`，加来源/生成/审核字段。新表：`settings`（目标日期/track/强度/提醒）、`tracks`（可增删的 tag 过滤器）。动机层/streak 从现有 `review_log` 算，不建新表。生成侧的 `gen_jobs`/pending cards 在服务器，不在本地 SQLite。

- `Card` (in `types.ts`): use `tags: string[]`; add `origin?: 'seed'|'ai'`, `reviewed?: boolean`, `source?: {...}`, `generatedBy?: 'source'|'feedback'`, `sourceCardId?`, `createdAt?`.
- New local tables: `settings(key, value)` (targetDate, activeTrackId, intensity, reminderTimes, dailyNewTarget) and `tracks(id, name, include, exclude)`.
- Motivation/streak: **derive from `review_log`** (no new table).
- Generation queue + pending cards: **server-side** (Phase 2b), not in the app's SQLite.

---

## 9. Visual atoms — nice-to-have, deferred

> **速读** ｜ 用户定调：核心是**答题**，不是靠复杂图去理解；图是**锦上添花**，等以后要提升 engagement 再说。所以：位图永不生成；生成服务**先专注文字问答卡**、不刻意产图；表格渲染继续低优先。M1 已有的 Mermaid 渲染器保留给种子卡，够用。

Confirmed low priority — the core value is the **Q&A drill**, not comprehension via rich visuals. Therefore:
- **No raster/image generation, ever.**
- The generation service (§7) **focuses on text Q&A cards** (`why` / `why_en` / options). A `diagram` may be added opportunistically but is **never a goal**.
- Keep M1's existing Mermaid renderer for seed cards that already carry diagrams (it's free). The Markdown `table` renderer stays deferred — build only if trivial.
- Revisit richer visuals later, when engagement needs a boost.

---

## 10. Milestones

> **速读** ｜ M2a 动机层+规划器+标签路径+设置（纯本地，无 key，价值最大）→ M2b 复盘升级 → M2c 生成服务 2a（手动，无服务器）→ M2d 生成服务 2b（后台队列+web+推送）。

- **M2a** — motivation layer (§2) + planner (§3) + tags/tracks (§4) + settings (§5). **Local-only, no key, highest ROI.**
- **M2b** — review/复盘 escalation + familiarity indicator + weekly weak-cards view (§6).
- **M2c** — generation Phase 2a: manual feedback→cards loop end-to-end (file export UX + re-import) (§7.3).
- **M2d** — generation Phase 2b: backend queue + web retrieval + tagging + push delivery (§7).

---

## 11. Open questions & risks

> **速读** ｜ ①生成内容正确性——所以"待确认"门槛别省。②后台服务是个人自用还是多用户？影响要不要真做 auth/账号。③web 检索的成本/延迟——用 Batches + 缓存。④"图片"=Mermaid，不做位图。⑤streak 口径要宽容，别因漏一天就清零打击积极性。

1. Generated content can be wrong on subjective trade-offs → keep the "AI 生成 · 待确认" gate; never auto-inject unreviewed as authoritative.
2. **Backend is single-user (just you) — DECIDED.** 2b therefore skips auth / accounts / multi-tenant entirely: the "server" can be as light as a personal script or a tiny single-user service that ingests your feedback, does web-grounded generation, and pushes results back. No login, no user isolation.
3. Web-grounded generation adds latency/cost → Batches API + prompt caching; that's why delivery is async (12h/next-day), not live.
4. "Images" means Mermaid/diagram specs, not raster — set expectations.
5. Keep streak forgiving (a missed light day shouldn't zero it) to avoid demotivating.

## 12. Out of scope for M2

Full multi-agent generation; raster image generation; social/leaderboards; Android polish; standalone (Mac-free) app builds.
