# Atoms — M1 pre-build design review

> 🗄 **ARCHIVED 2026-07-07** — 历史文档，只作背景与决策依据；文中路径/状态以当时为准。现行结构与标准见 `docs/INDEX.md`。

> Critical review of `atoms-design-doc.md` + `atoms-technical-design.md` + `content/databases-drill.html`, done before scaffolding M1 · reviewer: Claude (Fable 5) · date: 2026-07-01
>
> **读法**：正文英文，每节开头 `> **速读**` 中文。§2–§3 是必读（发现的矛盾和缺口，以及 M1 里我怎么处理的）；§4 是要留意的风险；§6 是 M1 具体取值的决策记录。

---

## 1. Verdict

> **速读** ｜ 设计核心是站得住的：原子分类法（尤其 fit 原子 + 决策链）、scenario 约束判分、"反馈驱动生成"闭环，都是真正好的想法；两平面架构（学习端无 key / 生产端有 key）也干净。**但三份文档 + 原型之间有一组真实的矛盾要先钉死（schema 有三个版本），原型里有一个会毁掉刷题效果的 bug（26/29 道选择题答案都在 B），还有几处关键交互从没被定义（自评分 × 客观对错怎么合并、当天内的重学怎么排）。** 以下逐条列出，均已在 M1 中按所述方式解决。

The core design is sound and worth building: the atom taxonomy (fit atoms + decision chains) is a genuinely good answer to "how do I fragment monolithic material"; scenario-constrained grading dissolves the no-single-answer objection; the feedback→generation loop is the most original piece. The two-plane split keeps secrets and AI risk fully out of the daily app.

But the docs and the prototype disagree with each other in specific, breaking ways, the seed deck has one bug that would silently destroy the drill's value, and several load-bearing interactions were never specified. Everything below was resolved as described before writing app code.

---

## 2. Contradictions found (and how M1 resolves them)

> **速读** ｜ ①卡片 schema 存在**三个**互相矛盾的版本（design doc §6 / tech doc 的 zod / 原型），不止 brief 说的 `en/other` 一处——M1 定稿一套并给出理由；②design doc 的 Atom/Card 双实体模型在真实数据里根本不存在（只有卡片）；③cloze 在文档里是"点选作答"，在原型和数据里是"翻牌自评"，数据里没有干扰项，M1 按翻牌实现；④决策链文档承诺"多合法顺序判分"，但数据一条 `acceptAltOrders` 都没有，原型只做精确匹配；⑤tech doc 的 zod schema 表达不了 cloze/chain/code 的字段，M3 前必须补，否则生成端产不出一半题型。

**2.1 There are three card schemas, not one naming nit.** The brief flags `en`/`other` vs `why_en`/`whenOtherWins`. The real divergence is wider:

| Field | design doc §6 | tech doc §3.3 (zod) | prototype (actual data) |
|---|---|---|---|
| question | `prompt` | `q` | `q` |
| choices | `options` | `options` | `opts` |
| correct | `answerIndex` (single) | `answer: number[]` | `answer: number[]` |
| explanation EN | `why_en` | `why_en` | `en` |
| when-other-wins | `whenOtherWins` | `whenOtherWins` | `other` |
| atom link | `atomIds` | `atomType` inline | `atomType` + `sub` inline |

**M1 canonical:** `q`, `options`, `answer: number[]`, `why`, `why_en`, `whenOtherWins`, plus `atomType`/`topic`/`sub` inline. One disclosed disagreement with the brief's "recommend the design doc's naming": I adopt the design doc's `why_en`/`whenOtherWins` but keep `q` and array-`answer`, because (a) `answerIndex` cannot express `multi` cards at all, and (b) the authoring-plane zod — the thing M3 will actually run — already says `q`/`answer[]`, so this choice minimizes future churn.

**2.2 The Atom/Card two-entity model exists only on paper.** Design doc §6 defines `Atom` entities with `atomIds` references; the entire seed deck has zero atom records — cards carry `atomType`/`sub` denormalized. M1 ships cards-only (matching reality). The formal Atom table should be introduced in M3, where it earns its keep (provenance for Mode-2 feedback generation, and sibling-card grouping — see §4.3).

**2.3 Cloze: docs say tap-to-answer, data says reveal-and-self-grade.** §5 gives cloze an output cost of "1–3 taps", implying selectable blanks; the prototype's cloze has no answer interaction at all (a reveal button), and the data contains no distractor options for blanks. M1 implements reveal-style (like Anki): show blanks → reveal → self-grade. Consequence: cloze cards produce no objective correctness signal (`wasCorrect = null`), which is fine but means correctness stats are format-skewed. If tappable cloze is wanted later, the authoring schema needs per-blank options.

**2.4 Chain grading: promised flexibility doesn't exist in data.** §5 promises dependency-based grading with multiple valid orderings and §6 shows `acceptAltOrders`; both seed chains have a single `answerOrder` and the prototype grades by exact match. M1 honors `acceptAltOrders` when present (cheap), but true dependency grading needs authored dependency pairs that no card has — that's an authoring-schema addition for M3, not app logic to invent.

**2.5 The authoring zod schema can't express half the formats.** Tech doc §3.3's `Card` zod has no `text` (cloze), no `steps`/`answerOrder` (chain), no `codeSample`/`lang` (code), no `diagram`/`table`. It's labeled illustrative, but if M3 starts from it, generation silently can't produce three of five formats. Must be brought up to the M1 canonical type before the first generation run.

---

## 3. Real gaps, fixed in M1

> **速读** ｜ ①**最严重：29 道选择题里 26 道正确答案都在 B**——不打乱选项顺序的话，刷题会训练出"闭眼选 B"。M1 每次渲染都打乱选项/链步骤并重映射答案；②文档从没定义"自评分"和"客观对错"怎么合并（答错了还点"记得"怎么办）——M1 规则：忘了→Again、模糊→Hard、记得→Good，但答错或用了"不确定"时"记得"封顶 Hard；③FSRS 短期学习步骤（1m/10m）意味着卡片当天内会再次到期，文档没说怎么办——M1 采用 Anki 式 20 分钟 learn-ahead + 会话内重新入队；④M1 没有 planner，新卡配额定死 10/天；⑤bundle 内容更新 vs SQLite 学习状态如何调和没定义——M1 启动时按 id upsert 内容、保留 SRS 状态。

**3.1 Position bias — the deck's one deadly bug.** Of the 29 choice-format cards (mcq/multi/code), **26 put the correct answer at index 1 ("B")**. The prototype renders options in authored order. Within a session or two, spaced repetition would efficiently teach the association "B is correct" instead of the content — the drill would *feel* productive while measuring nothing. M1 shuffles displayed option order (and chain step order) on every render, tracking a display→original index map so grading, correct-highlighting, and chain position numbers stay correct. This is the single highest-value fix in the review.

**3.2 Self-grade × objective correctness was never defined.** The app has two signals per card: the objective outcome (picked B, B was wrong) and the subjective 3-button grade. The docs specify only the second. What happens when a user answers wrong and taps 记得? M1 rule, applied uniformly:

- 忘了 → `Again` · 模糊 → `Hard` · 记得 → `Good`
- If the card was answered **objectively wrong** or revealed via **不确定**, 记得 is capped to `Hard`.
- Cloze (no objective signal, per 2.3) is graded purely by self-assessment, uncapped.
- `Easy` is unused — a deliberate cost of the 3-button UI (§8's "again/hard–good/easy" dash was ambiguous). Intervals for easy cards grow slightly slower; acceptable, revisit in M2 if reviews pile up.

**3.3 Intraday relearning was unspecified.** ts-fsrs (short-term mode, default on) schedules a lapsed card ~1–10 *minutes* out. "Daily queue = due-today + new" says nothing about cards that come due again mid-session. M1 adopts Anki's standard answer: a 20-minute learn-ahead window — after each grade, any card due within `now + 20min` and not already pending is appended to the session queue. So a forgotten card is re-drilled the same session until it graduates to a multi-day interval. The Today screen also surfaces "稍后还有 N 张今天到期".

**3.4 M1 has no planner, so the new-card quota needed a source.** `newPerDay` comes from the M2 goal-planner. M1 hardcodes `NEW_PER_DAY = 10` (in `src/config.ts`, one line to change), introduces new cards in deck order, reviews-before-new.

**3.5 Bundled content vs on-device state reconciliation was undefined.** Cards ship in the bundle; FSRS state lives in SQLite. When `cards.json` changes (M3 will generate new cards continuously), what happens to existing state? M1: on every launch, upsert card *content* by id (bundle wins), preserve SRS state, insert new cards as new. Removed cards keep orphan state rows (harmless, filtered on load).

---

## 4. Risks to watch (not blocking M1)

> **速读** ｜ ①**运营现实：Expo Go 方案意味着每天学习时 Mac 要开着 Metro**（或赌 Expo Go 的离线缓存）——对一个主打"粘性"的日刷工具这是真风险，出路是 EAS Update（免费档）或 dev-client；另外 SQLite 数据活在 Expo Go 沙盒里，slug 要保持稳定、删 Expo Go = 删学习记录，M2 该加状态导出备份；②选择题重复刷会退化成"认出答案"而非"想起理由"——设计里已有缓解（链题、朗读），建议再加"揭示前先口头说出理由"的习惯 + M3 每原子多变体；③M3 一个原子生成多张卡后会有 Anki 的"兄弟卡"问题（同一知识被重复调度）——需要 Atom 表 + sibling burying；④反馈闭环目前要手动导出→贴给 AI→重新打包→重启 Metro，M3 要把这条链路缩短；⑤Number 原子用选择题练不对路（认出 ~100k ≠ 想起 ~100k），更适合 cloze。

**4.1 The Expo Go operational reality undercuts "stickiness first".** Loading via QR means Metro must be running on the Mac, on the same Wi-Fi, every study session — or you rely on Expo Go's cached last bundle, which is not a guarantee. For a tool whose entire thesis is near-zero activation energy, "first open the laptop" is a real tax. Fine while daily interview prep happens at the Mac anyway; the escape hatch when it starts to hurt is **EAS Update** (free tier: publish the bundle, Expo Go loads it from a URL, Mac-free) — no App Store, no paid account, consistent with all settled decisions. Related: SQLite data lives inside Expo Go's sandbox, scoped by the project slug — the slug is set to `atoms` and must stay stable; deleting Expo Go deletes study state. An SRS-state export (one tap, like the feedback export) is cheap insurance worth adding in M2.

**4.2 MCQ re-exposure trains recognition, not production.** Acknowledged in §12.3; two additions worth making: (a) as a habit, *say the justification aloud before revealing* — the app can't check it, but the ritual converts recognition practice into retrieval practice; (b) in M3, generate 2–3 scenario variants per fit atom so the surface form varies while the atom repeats.

**4.3 Sibling cards will break scheduling in M3.** Today cards↔atoms are 1:1. The moment generation produces several cards per atom, FSRS schedules each independently — the same knowledge gets over-reviewed and reviews of one sibling silently refresh the others (inflating their measured stability). This is Anki's classic sibling problem; the fix (Atom table + bury-siblings-until-tomorrow) is exactly why 2.2's formal Atom entity should land in M3.

**4.4 Feedback loop friction.** M1's loop is: export JSON → paste to Claude → get cards → re-run port → restart Metro. Fine at 34 cards; at 300+ it needs the M3 script plus a one-command "regenerate + rebundle".

**4.5 Number atoms are miscast as MCQ.** Recognizing "~100k ops/s" among three absurd distractors (~1k / ~1亿 / ~100亿) is much easier than recalling the number — the format inflates confidence exactly where the design wants durable anchors. Convert number atoms to cloze in a later content pass.

**4.6 Minor.** Feedback export conflates 忘了 and 不确定 as `"unknown"` (prototype semantics, kept for §13 compatibility — the true FSRS rating is logged separately in `review_log`, so no signal is lost). `expo-speech` uses iOS system voices — serviceable, not Siri-quality. Tech facts drift (§12.5) — source refs are kept on cards.

---

## 5. Pushback on settled decisions (one line each, then complied)

> **速读** ｜ 两条不同意但照做：①Mermaid 在 app 内渲染意味着给 WebView 捆一个 ~2.8MB 的 mermaid.min.js（为了离线），其实在生产端预渲染成 SVG 文本更轻——按决定照做了，带降级；②schema 命名没全按 design doc（理由见 2.1）。

- **Mermaid-in-app:** pre-rendering diagrams to SVG in the authoring plane would keep the app free of a ~2.8MB bundled mermaid.min.js + WebView bridge; complied anyway (bundled asset, fully offline, graceful fallback to showing the spec as code if rendering fails).
- **Canonical naming:** kept `q`/`answer: number[]` over the design doc's `prompt`/`answerIndex` (rationale in 2.1); adopted `why_en`/`whenOtherWins` as recommended.

---

## 6. M1 decision log

> **速读** ｜ 建 app 时具体取的值，全部集中在这里，改起来知道去哪儿。

| Decision | Value | Where |
|---|---|---|
| Canonical card schema | 2.1 above; ported data normalized (`en`→`why_en`, `other`→`whenOtherWins`, `opts`→`options`, `topic:"databases"` added) | `src/types.ts`, `scripts/port-cards.mjs` |
| New cards/day (M1) | `10`, deck order, reviews first | `src/config.ts` |
| Learn-ahead window | 20 min (Anki default) | `src/config.ts` |
| Grade mapping | 忘了→Again · 模糊→Hard · 记得→Good; capped to Hard if wrong/IDK; Easy unused | `src/logic/grading.ts` |
| Review-state "due today" | by local calendar date; learning states by exact time + learn-ahead | `src/logic/queue.ts` |
| Option/step shuffling | every render, display→original remap | `src/logic/shuffle.ts` |
| Chain input | tap-in-order (not drag) + 重选 reset; wrong answer reveals correct numbering | prototype parity |
| Cloze | reveal-style, self-graded, `wasCorrect=null` | 2.3 |
| TTS | manual 🔊 tap, `en-US`, rate 0.95 (no autoplay) | prototype parity |
| Diagrams | Mermaid via WebView + bundled `mermaid.min.js` asset; fallback = spec as code block. **Added `diagram` to db-017 & db-024** (zero seed cards had one; renderer needed real data) — disclosed content addition | `src/components/MermaidView.tsx` |
| `table` visual atom | type reserved, renderer deferred (not in M1 explanation spec, no data) | M2 |
| Feedback | 5 flag chips + term + note, SQLite-backed; export via iOS share sheet (includes Copy), same item shape as design §13 | `src/logic/feedback.ts` |
| Content↔state reconcile | launch-time upsert by id: content refreshed from bundle, SRS state preserved | `src/db/database.ts` |
| Slug (data scoping) | `atoms`, keep stable | `app.json` |
