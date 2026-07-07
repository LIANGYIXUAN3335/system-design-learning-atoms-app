# Atoms — M2a Convergence Plan (make the 6000 cards usable, and not 干巴)

> Focused build increment · extends Fable's M1 in `atoms-app/` · full detail for motivation/planner/tracks/rhythm lives in `atoms-m2-spec.md` §2–5 — this plan is the **M2a slice + the deltas discovered after that spec was written** (wire the bundle, topic granularity, de-干巴 presentation, and what's now deferred). · date: 2026-07-01
>
> **给 Fable**：先读这份计划 + `atoms-m2-spec.md` §2–5 + 现有 `atoms-app/` 代码，**批判性审一遍再动手**；这是在 M1 上扩展，不是重写；只做 M2a，别碰后台/生成服务。

---

## 0. Goal

> **速读** ｜ 一句话：内容已经有 ~6000 张（4 条 track、覆盖大半个 Hello Interview），但 app 只显示 34 张、也没导航、丰富度没渲染。M2a 只干一件事——**让这 6000 张可用、且刷起来不干巴**：接上整包 + track/主题导航 + 每日目标/斩杀 + 节奏设置 + 把已有的场景/图/朗读渲染出来。**不砍卡、不生成、不做后台。**

Content is done (~6000 valid cards, 4 tracks). The app isn't: it still shows the 34 seed cards, has no navigation, and doesn't render the richness that already exists in the data. M2a makes the existing content **usable and vivid** — nothing more.

---

## 1. Governing constraints (do not violate)

> **速读** ｜ 铁律：①在 M1 上扩展不重写 ②FSRS 是唯一调度器（节奏预设只调它，不另造排期）③本地优先、M2a 无 API key / 无后台 ④**保留全部 ~6000 张，不做"精选 300"** ⑤正确性验证、场景增补、生成后台 = **本期范围外**（以后交给便宜模型 / M2c-d）。

- **Extend M1, don't rewrite.** Respect `src/types.ts`, `src/logic/{srs,queue,grading,...}.ts`, `src/db/database.ts`, `review_log`, the screens, and the generation scripts.
- **FSRS is the only scheduler.** The rhythm preset tunes it (`request_retention`) + sets reminders; it must not become a second scheduling rule.
- **Local-first. No API key, no Anthropic dependency, no backend in M2a.**
- **Keep all ~6000 cards.** Do **not** curate down to a "high-yield core" — breadth + SRS + the planner (paced new-cards/day) is the model; the planner prevents overwhelm, not deletion.
- **Out of scope (deferred):** correctness verification of the 6000 (→ a cheap model, later), scenario-enrichment (→ cheap model, later), the generation backend/queue/push (→ M2c/M2d), image/raster generation, curation. Do not build these.

---

## 2. Workstream A — Wire the full deck + navigation  ★ the #1 blocker

> **速读** ｜ ①App 改成 import `deck.bundle.json`（~6000）而不是 `cards.json`（34）。②`topic` 太粗（全是 track 名），真正的分类在文件名里——**让 `build-deck.mjs` 在合并时给每张卡盖上 `track` + `category`（从文件夹/文件名推导），卡片文件本身不用改。** ③首页做 track 选择器（读 `tracks.json`）→ 可再按 category 过滤 → 开始刷。牌堆 = 所选范围的并集，保留全部卡。

- **Import the bundle.** `App.tsx` currently imports `cards.json` (34). Switch to `src/content/deck.bundle.json` (~6000). Fix the hardcoded "数据库选型 · N 张卡" label on `TodayScreen` accordingly.
- **Fix topic granularity at build time (don't touch card files).** Cards' `topic` is coarse (track-level, e.g. `system-design`); the real category is only in the source filename. Extend `scripts/build-deck.mjs` to **stamp two fields on every card as it merges**:
  - `track` — from the top folder (`system-design` → `classic-sd`, `ai-coding`, `llm-sd`, `low-level-design`); build-deck already computes "by track", reuse it.
  - `category` — derived from the filename, e.g. `deep-dives_kafka.json` → `Kafka`, `core-concepts_caching.json` → `缓存/Caching`, `problem-breakdowns_instagram.json` → `Instagram`. (A small filename→display-name map, or strip the `<group>_` prefix and title-case.)
  - Add `track?: string` and `category?: string` to the `Card` type in `types.ts`. Re-run `build-deck` so the bundle carries them.
- **Navigation UI (Home):**
  - A **track picker** (chips or list) from `tracks.json` — classic-SD / ai-coding / low-level-design / llm-sd.
  - Within the active track, a **category browser** (list of categories with card counts + per-category mastery). Selecting a category scopes the deck; "全部" = the whole track.
  - Session deck = the union of cards in the active scope. All cards remain; the planner (§4) paces how many new appear per day so the user is never dumped 6000 at once.

---

## 3. Workstream B — Motivation layer (daily goal · streak · 斩杀)

> **速读** ｜ 数据现成（`review_log` 每条带 day/correct），不建新表。加：①每日目标环（今日 X/Y，Y=今日到期+newPerDay）②🔥连续天数（清空当日队列即+1，宽容口径）③Done 页改成"本次斩杀 8 · 今日 20/20 · 🔥连续 6 天"。细节见 `atoms-m2-spec.md` §2。

Implement `atoms-m2-spec.md` §2 as written. Home shows a daily-goal ring + streak; the session header shows live `斩杀 N`; Done reframes to `本次斩杀 {n} · 今日 {x}/{target} · 🔥 连续 {streak} 天`. Use **distinct cards answered today** (not raw `review_log` rows) for the goal count. Per-track/category scoping: goal and streak are computed within the active track.

---

## 4. Workstream C — Planner (每日任务)

> **速读** ｜ 面试日期 D + 面试类型 → 选定 track。`newPerDay = clamp(ceil((该 track 未掌握原子数)/(D×0.8)), 1, ~15)`，超上限就提示"延期/换 track"。替换 M1 的 `NEW_PER_DAY` 常量。这就是"不砍卡也不淹用户"的关键——广度靠库，节奏靠 planner。详见 `atoms-m2-spec.md` §3。

Implement `atoms-m2-spec.md` §3. Scope `N` to the **active track's** remaining-unmastered count (not all 6000). This is how breadth is preserved without overwhelm — the planner trickles new cards; FSRS paces reviews.

---

## 5. Workstream D — Rhythm preset (settings)

> **速读** ｜ 一个用户选择"节奏"：早晚刷 / 每天刷 / 隔天刷 → 同时定"提醒频率 + FSRS request_retention(0.95/0.90/0.85)"。用户的选择是**调 FSRS 的旋钮**，不是另造调度器。详见 `atoms-m2-spec.md` §5。

Implement `atoms-m2-spec.md` §5 (the rhythm table). One user choice sets both `expo-notifications` cadence and `request_retention` in `srs.ts`. Do not add a manual "redo wrong cards" rule.

---

## 6. Workstream E — De-干巴 presentation  ★ new (why the product feels dry)

> **速读** ｜ 关键发现：产品"干巴"是**呈现缺口，不是内容缺口**。数据里 69% 是单选、只有 29% 带场景、且场景偏短——但真正的问题是**这些场景/图/朗读在 app 里现在根本没渲染**（还停在 34 张种子卡）。M2a 要把 M1 已有的组件（ScenarioBox / MermaidView / expo-speech）**用到全部 6000 张上，并让场景/图/朗读唱主角**，别做成一面"刷题墙"。**注意：只渲染已有的丰富度，不新生成/改写内容**（那是以后便宜模型的活）。

The dryness is a **presentation gap**. The richness already exists in the data (scenarios on ~29% of cards, Mermaid diagrams, English restatements, 5 formats) — the app just isn't showing it. M2a wires M1's existing components to the full deck and leads with them:

- **Scenario first.** When a card has `scenario`, render it prominently as the "situation" above the question (M1's `ScenarioBox` — apply to all cards, make it visually the hook).
- **Show the diagram.** Render `diagram` (Mermaid) in the reveal for every card that has one (M1's `MermaidView` — wire for the full deck, not just seed).
- **Finish the small table renderer.** `table` was deferred in M1; ship the simple Markdown/`{headers,rows}` renderer now — it adds variety cheaply and several decks use tables.
- **English restatement + 🔊.** Ensure the `why_en` line + a clear "🔊 朗读" button (expo-speech) is present and prominent on every reveal — this is the multi-sensory hook and it breaks the text monotony.
- **Vary the rhythm, not just MCQ.** The data already has cloze/chain/code/multi — make sure chain (ordering) and cloze render as genuinely different interactions, so a session doesn't feel like 4000 identical A/B/C/D taps.

Explicitly **not** in E: rewriting/enriching scenarios, adding scenarios to context-free cards, generating diagrams. Those are the deferred cheap-model pass.

---

## 7. Data model / build changes (concrete)

> **速读** ｜ 卡片类型加 `track` / `category`（build 时盖章）。build-deck 增强：合并时按文件夹→track、文件名→category 盖章。动机层从 `review_log` 算，不建新表。新增本地 `settings` 表（目标日期/active track/节奏/提醒）。

- `types.ts` `Card`: add `track?: string`, `category?: string`.
- `scripts/build-deck.mjs`: stamp `track` + `category` per card during merge (from folder + filename); no card files edited.
- New local table `settings(key,value)`: targetDate, activeTrackId, activeCategory, rhythm, reminderTimes, dailyNewTarget.
- Motivation/streak: derived from `review_log` (no new table).

---

## 8. Order within M2a

> **速读** ｜ 先接包+导航（不接上，其它都看不到）→ 再动机层 → 再 planner+节奏 → 再去干巴呈现。

1. **A first** — bundle import + build-deck stamping + track/category navigation. (Without this, nothing else is visible on the full deck.)
2. **B** — motivation layer (goal + streak + 斩杀).
3. **C + D** — planner + rhythm settings.
4. **E** — de-干巴 presentation (scenario-first, diagram, table renderer, TTS prominence).

---

## 9. Out of scope for M2a

Generation backend / queue / push (M2c–d); correctness verification of the 6000 (cheap model, later); scenario-enrichment (cheap model, later); curation to a smaller core; image/raster generation; multi-user/auth; Android polish; standalone (Mac-free) builds.

---

## 10. Done criteria

- `npm run verify` (typecheck + selftest) passes; `node scripts/build-deck.mjs` produces a bundle with `track`+`category` on every card.
- On the phone (Expo Go): pick a track → browse categories → drill; daily-goal ring + streak + 斩杀 show; rhythm preset changes reminders + retention; scenarios, diagrams, tables, and 🔊 render for the full deck.
- Give the run steps.
