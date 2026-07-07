# Atoms — M2a pre-build review (spec vs. code)

> Critical review of `atoms-m2-spec.md` **against the actual M1 codebase** (`atoms-app/`), done before implementing M2a · reviewer: Claude (Fable 5) · date: 2026-07-01
>
> **读法**：§1 是 spec 假设与代码现实的差距（M2a 必须先补的内容管线）；§2 是 spec 内部含糊处及我采用的解释（每条一行理由）；§3 是硬约束核查（无违反）；§4 是一行式异议；§5 是决策日志。

---

## 1. Spec assumes things the codebase doesn't have yet

> **速读** ｜ spec §4 说"复用 Card.tags、给 11 张 agent 卡打标签"——现实是：34 张 db 卡 **0 个 tag**；11 张 ag 卡 + 6 张 cr 卡还躺在 HTML 里**没移植**（旧字段名 `opts/en/other`）；`build-deck.mjs` 写了但**从没跑过**，`deck.bundle.json` 不存在；App.tsx 还在 import 34 张的 `cards.json`，107 张已生成的 system-design 卡对 app 完全不可见。所以 M2a 的第一步是内容管线，不是 UI。

Findings against the working tree:

1. **The app sees 34 of 158 available cards.** `App.tsx` imports `src/content/cards.json` (34 db cards); `src/content/system-design/` holds 107 generated, *already-tagged* cards; `scripts/build-deck.mjs` (merger → `deck.bundle.json`) exists but its output was never generated or wired in.
2. **The 17 hand-authored new cards aren't ported.** `ai-agents-drill.html` (11) and `consistency-replication-drill.html` (6) use the *legacy* field names (`opts`/`en`/`other`) that M1's review canonicalized away. They must go through the same normalizer as the db deck.
3. **Tags exist on 107 cards, on 0 of the 51 hand-authored ones.** Track filtering matches tags — untagged cards would silently vanish from every track.
4. **New content carries a `table` shape the type system doesn't know.** 5 ag/cr cards ship `table: {headers, rows}` (structured object), while `types.ts` declares `table?: string` (Markdown, M1-deferred, zero data ever). The object form makes rendering trivial (no parsing); spec §9 says *"build only if trivial"* — it now is. Type changes to the object form; a ~40-line native renderer ships in M2a. This is **display of existing seed content**, not visual generation — consistent with the 降级 constraint.

**M2a therefore starts with content plumbing:** port ag/cr through the canonical normalizer (+ diagrams/tables preserved), tag all 51 hand-authored cards, inject `track:*` tags at build time, run the bundle (158 cards), point `App.tsx` at `deck.bundle.json`, and extend `selftest` to validate the bundle.

---

## 2. Underspecified points and the readings I implemented

> **速读** ｜ 逐条：streak 的"清空队列"口径**从 review_log 推不出来**（历史队列没快照）→ 采用宽容口径"当天≥1 次复习"；每日目标的字面公式在刷完后会塌缩 → 改为「已答(去重) + 仍到期 + 剩余新卡配额」单调口径；per-track streak 不可行（log 无 track 列、tag 会变）→ 目标环按 track、streak 全局；新卡配额按 track 计；其他 track 的到期卡在 Today 给一行提示不混排；隔天提醒没有原生触发器 → 每次启动重排未来 7 天的 DATE 触发器；topic:* 前缀 retrofit 无消费方 → 只落地 track:* tag（build 时按来源目录注入，一处可见）。

1. **Streak definition.** Spec §2 wants "day's due queue was cleared (or ≥1 review when nothing was due)" *and* says to derive from `SELECT DISTINCT day FROM review_log`. Whether a *past* day's queue was cleared is not reconstructible from `review_log` (queue composition was never snapshotted; FSRS state has moved since). The derivable reading is the forgiving one the spec itself asks for in §11.5: **a streak day = any local day with ≥1 review**. Walking back from today (today counts if studied, else the walk starts at yesterday so a morning streak isn't 0).
2. **Daily target formula.** Literal `dailyTarget = dueTodayCount + newPerDay` shrinks as you study (due count falls), so the ring's denominator moves. Implemented as a monotone-within-day equivalent: `target = distinctAnsweredToday + stillDueNow + remainingNewQuota` — reaches 100% exactly when the day's queue is cleared, and re-lapsed cards count once (`COUNT(DISTINCT cardId)`, fixing M1's raw-row over-count as §2 asks).
3. **Per-track goal vs per-track streak.** §4 says goal *and* streak compute "within the active track", but `review_log` has no track column and tags mutate over time — historical per-track streaks would be revisionist. **Goal ring: per-track (live data). Streak: global.** One habit, one flame.
4. **New-card quota scope.** M1's `introducedTodayCount` is global; a per-track planner implies per-track pacing. Quota now counts only cards introduced today **within the active track's deck**. Consequence (accepted): studying two tracks in one day stacks their quotas — that's an explicit user action.
5. **Cross-track due debt.** With deck = active track, due cards in other tracks are invisible and FSRS debt accrues silently. Today screen shows a one-line hint (`其他路径另有 N 张到期`) — no auto-mixing (spec: deck = track's union).
6. **Planner edge cases.** Past/today `targetDate` → `D` clamps to 1 with an explicit "面试日期已过/就是今天" warning; no `targetDate` → fall back to the M1 default (10/day), no warning; raw value > `COMFORT_MAX(20)` → clamp + "延期或砍范围" warning, as specced. `MASTERED_STABILITY_DAYS(7)` moves from `App.tsx` into `config.ts` (planner + UI both need it).
7. **Reminders implementation.** v57 docs: local notifications fine in **Expo Go iOS**, **web unsupported** (guarded — the web demo must not crash), and there's no native "every other day" repeating trigger. All three rhythms use **one code path**: on every app launch and settings change, cancel + reschedule explicit `DATE` triggers for the next 7 days (≤14 notifications, far under iOS's 64 cap). Self-healing because opening the app is the habit being reinforced. Caveat accepted: >7 days without opening the app = reminders lapse.
8. **Tag convention.** Spec §4's example shows `topic:*` + `track:*` prefixed tags; the 107 generated cards use plain topical tags (`caching`, `cap`, …) with no prefixes. Retrofitting `topic:*` across 107 cards has no M2a consumer — skipped. **`track:*` tags are the part tracks consume**, injected at build time from a visible source-dir→track map in `build-deck.mjs` (sources stay pristine; future decks either land in a mapped dir or carry their own `track:*` tags). Cards can also carry explicit `track:*` tags (union, dedup).
9. **`settings.dailyNewTarget` (§8).** Read as a manual-override slot; M2a derives `newPerDay` from the planner only (no override UI). Key reserved, unused.
10. **LLM-SD seed track starts empty.** No LLM-system-design content exists yet; force-tagging ag cards into it would be wrong. It seeds as an empty track (structure is the point; M2c generation fills it). The track picker shows its 0 count honestly.
11. **"全部" pseudo-track.** Spec's picker lists tracks only; without an all-cards option the 107 system-design cards would need a track before being studyable at all… they have one (classic-sd), but a no-filter view is still the sane default before the user configures anything. Added as a built-in non-deletable `all` entry (code, not DB).

---

## 3. Hard-constraint check — no violations needed

> **速读** ｜ 四条铁律全部可满足：FSRS 唯一调度器（节奏只动 request_retention + 提醒）；本地零 key；表格渲染是"展示既有内容"不是生成；后台服务完全不碰。

- **FSRS-only:** the rhythm preset writes `request_retention` through a new `setRequestRetention()` in `srs.ts` (scheduler rebuilt; per-card state untouched — retention is a scheduling parameter, so switching rhythm mid-stream is safe and affects only future grades). Reminders are notifications, not a queue. No "morning redo" rule anywhere.
- **Local-first:** M2a adds one dependency, `expo-notifications` (local triggers only). No key, no network, no backend.
- **Visual atoms:** only the existing Mermaid renderer + the trivial table renderer for already-shipped seed content. Nothing generates visuals.
- **Generation service:** untouched (M2c/M2d). The type gains the §8 provenance fields (`origin`/`reviewed`/`generatedBy`/`sourceCardId`/`createdAt`) so M2c cards won't need a schema migration — fields only, no behavior.

---

## 4. Disagreement one-liners (已定决策，照做)

- `request_retention 0.85` for 隔天 is at the practical floor (more lapses by design; total time drops) — fine for a deadline tool, just don't go lower later.
- `COMFORT_MAX = 20` new/day ≈ 25–30 min steady-state with the 2–3× review tail — consistent with the design doc's math; complying.
- Forgiving streak (1 card keeps the flame) trades rigor for retention psychology — spec §11.5 chose this deliberately; complying.

---

## 5. M2a decision log

| Decision | Value | Where |
|---|---|---|
| Deck source | `deck.bundle.json` (158 = 34 db + 107 system-design + 11 ag + 6 cr), built by `build-deck.mjs`; App imports the bundle | `App.tsx`, `scripts/build-deck.mjs` |
| Track tags | injected at build: seed+`system-design/`→`track:classic-sd`, `ai-coding/`→`track:ai-coding`, `llm-sd/`→`track:llm-sd` | `scripts/build-deck.mjs` `DIR_TRACK_TAG` |
| Track model | `{id, name, include[], exclude[]}`, match = ANY include ∧ no exclude; `all` built-in | `src/logic/tracks.ts`, `tracks` table, seeds in `src/content/tracks.json` |
| Planner | `clamp(ceil((N−mastered)/(D×0.8)), 1, 20)`; D≥1; fallbacks + warnings per §2.6 | `src/logic/planner.ts`, `COMFORT_MAX` in `config.ts` |
| Rhythm→FSRS | 早晚 0.95 · 每天 0.90 · 隔天 0.85 via `setRequestRetention` at init + on change | `src/logic/srs.ts`, `src/logic/settings.ts` |
| Reminders | date-trigger batch, next 7 days, rescheduled on launch/change; Expo-Go-iOS ok, web no-op | `src/notifications.ts` |
| Streak | global, ≥1 review/day, today-or-yesterday anchor | `src/logic/streak.ts` |
| Goal ring | per-track: `done(distinct) / (done + dueNow + newQuotaLeft)` | `src/logic/streak.ts`, Today |
| 斩杀 copy | Session header `斩杀 N · 剩余 M`; Done `本次斩杀 X · 今日 Y/Z · 🔥 N 天` + 达成庆祝 | `SessionScreen.tsx`, `DoneScreen.tsx` |
| Settings storage | `settings(key,value)` KV + `tracks` table; schema v2 migration | `src/db/database.ts` |
| Table atom | type → `{headers, rows}`; native renderer | `types.ts`, `src/components/TableView.tsx` |
