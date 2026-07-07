# Atoms — Technical Design

> Technical design · companion to `atoms-design-doc.md` · status: DRAFT · date: 2026-07-01
>
> **读法**：正文英文，每节开头 `> **速读**` 中文速读。本篇只讲"怎么造"（架构、AI 生成、API key、闯关/规划、技术选型），产品模型见主设计文档。

---

## 1. TL;DR

> **速读** ｜ 整个系统分成互不干扰的两半：**学习端**（你每天用的 Expo app，纯本地、无 AI、**不需要 API key**）和 **生产端**（离线把内容变成卡片，只有这里才碰 AI 和 key）。闯关/目标/每日量都只是学习端里**基于 FSRS 的一层薄逻辑**，不是单独的游戏引擎。生成卡片用 **Anthropic SDK 的一次「结构化输出」调用**就够——**不需要 LangChain**。

Atoms splits into two planes that never share secrets:

- **Study plane** — the Expo app you drill in daily. Local-first (SQLite + `ts-fsrs`), no AI at runtime, **no API key ever ships in it**.
- **Authoring plane** — an *offline* step that turns source material or your feedback into `cards.json`. This is the only place an AI model and an API key appear.

Gamification, goals, and "cards/day" are a thin deterministic layer computed from the same local FSRS/session state — not a separate engine. Card generation is a **single structured-output call** to the Anthropic API; **LangChain is not needed**.

---

## 2. System architecture

> **速读** ｜ 一张图看清：左边"生产端"（有 key），右边"学习端"（无 key），中间用 `cards.json` 连接。API key **只**存在于左边，而且左边有三种跑法（用我 / TS 脚本 / LangChain）。

```
     AUTHORING PLANE  (offline · has API key)              STUDY PLANE  (daily · NO key)
     ─────────────────────────────────────                ─────────────────────────────
 HI / Educative ─┐
                 │   ┌───────────────────────────┐
 your feedback ──┼──►│ generation — 3 ways:       │              ┌────────────────────┐
   (Mode 2)      │   │  A. Claude Code (no key)   │              │  Expo app (RN+TS)  │
                 │   │  B. TS script + API KEY ◄─┐│  cards.json  │  · render card     │
 design doc ─────┘   │  C. LangChain (skip)      ││ ───────────► │  · 🔊 expo-speech   │
   (schema+taxonomy) │  → structured output JSON ││              │  · ts-fsrs (SRS)   │
                     └───────────▲───────────────┘│              │  · planner + XP    │
                                 │      the KEY lives ONLY here   │  · expo-sqlite     │
                          you review / approve      (option B)    └─────────┬──────────┘
                                                                            │
                                                                     you drill daily
```

**Key insight:** the app is a *consumer* of `cards.json`; it never generates. So the app has no model, no key, no network dependency. All AI risk (cost, secrets, correctness review) is confined to the authoring plane, which you run occasionally and eyeball before importing.

---

## 3. The AI generation subsystem

> **速读** ｜ 回答你的两个问题。**要不要 key？** 取决于你怎么跑生成：用我（Claude Code）跑 = **不用 key**；用你自己的脚本自动跑 = **要 key**（Anthropic Console 拿，放环境变量，绝不写进代码/app/git）。**要不要 LangChain？** 不要——把"文本→JSON 卡片"这种任务，Anthropic SDK 的一次「结构化输出」调用最简单、最稳；LangChain 是给多步链/agent/检索用的，这里用是过度设计。

### 3.1 Do I need an API key? — three ways to run generation

| Option | Needs API key? | When | Effort |
|---|---|---|---|
| **A. Run it through me (Claude Code / Claude)** | **No** | Now, M0–M2. You paste a chapter or feedback JSON; I return schema-valid cards; you drop them in. | Zero infra |
| **B. A local TS script calling the Anthropic API** | **Yes** | When manual paste gets tedious / you want to batch many chapters or automate the feedback→cards loop. | ~1 file, ~60 lines |
| **C. LangChain** | Yes + extra deps | Only if you want the *learning exercise*. Not required. | More moving parts |

**Recommendation:** stay on **A** until it's annoying, then build **B**. The API key first appears in B and nowhere else.

### 3.2 The API key (only relevant for Option B)

- Get it from **console.anthropic.com** → API keys. It's pay-per-token, billed to your account.
- Put it in an **environment variable** `ANTHROPIC_API_KEY`. The SDK client (`new Anthropic()`) reads it automatically. **Never** hardcode it, commit it, or bundle it into the Expo app.
- It lives only in the authoring machine's env (or a `.env` that's git-ignored). The study app never needs it.
- **Cost is tiny for personal use.** Rough card-gen rates (per 1M tokens): Opus 4.8 = $5 in / $25 out; Sonnet 4.6 = $3 / $15; Haiku 4.5 = $1 / $5. Generating a whole topic's worth of cards is cents to low single-digit dollars.

### 3.3 The core technical mechanism: structured output

The reason this is a *single call*, not a fragile pipeline, is **structured output** — you hand the model a JSON Schema and the API guarantees the response matches it. No regex, no "please return JSON" hoping.

```ts
// Illustrative — the generation call shape (TypeScript, @anthropic-ai/sdk)
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const client = new Anthropic();              // reads ANTHROPIC_API_KEY from env

const Card = z.object({
  id: z.string(), format: z.enum(["mcq","multi","cloze","chain","code"]),
  atomType: z.enum(["fact","fit","contrast","consequence","number"]),
  scenario: z.string().optional(), q: z.string(),
  options: z.array(z.string()).optional(), answer: z.array(z.number()).optional(),
  why: z.string(), why_en: z.string(), whenOtherWins: z.string().optional(),
});
const Batch = z.object({ cards: z.array(Card) });

const res = await client.messages.parse({
  model: "claude-opus-4-8",                  // quality matters for correctness; Haiku/Sonnet = cheaper
  max_tokens: 16000,
  system: ATOMIZE_INSTRUCTIONS,              // §4 taxonomy + rules (stable → cache this, §3.5)
  messages: [{ role: "user", content: chapterText }],
  output_config: { format: zodOutputFormat(Batch) },
});
const cards = res.parsed_output!.cards;      // typed, schema-valid
```

Notes tied to the current API: on `claude-opus-4-8` there is **no `temperature`** parameter (removed — steer with the prompt), and you don't need `thinking` for straightforward extraction. This same call is what the `/atomize` skill encodes.

### 3.4 The two generation modes

Both are the *same* structured call with a different `system` + input:

- **Mode 1 · Source → cards** — `system` = atomization rules; input = a Hello Interview / Educative chapter.
- **Mode 2 · Feedback → cards** — `system` = "fill these gaps"; input = the exported feedback JSON (term-unclear, too-hard, possibly-wrong…) from the drill. Output = targeted new/fixed cards. (See design doc §13.)

### 3.5 Scaling levers (only when volume grows)

- **Batches API** — `client.messages.batches.create({ requests: [...] })` runs many chapters async at **50% off**. Use when generating a whole topic tree at once.
- **Prompt caching** — the atomization `system` (taxonomy + schema, large + stable) is a perfect cache prefix: mark it `cache_control: { type: "ephemeral" }` and repeated calls read it at ~0.1× cost. Put the varying chapter text *after* it.

### 3.6 Why not LangChain (given you're learning it)

LangChain earns its keep when you have **multi-step chains, autonomous agents, retrieval over a big corpus, or want to swap providers**. Card generation is none of those — it's one prompt in, one validated JSON out. A direct SDK call is fewer dependencies, easier to debug, and uses the API's own schema-enforcement. **Verdict: skip it for Atoms.** If you want LangChain practice, you *could* wrap this one call as a trivial `prompt → LLM → output-parser` chain — just know it's optional sugar over the same request, not a capability you need.

---

## 4. Gamification + planner subsystem

> **速读** ｜ 目标/每日量/闯关全是学习端里的**纯本地计算**，数据都来自 FSRS 和刷题记录，没有服务器、没有单独游戏引擎。给定"目标日期 + 范围"，用一个公式算出"每天几张新卡"；每日任务 = 到期复习 + 新卡配额；闯关 = 每个主题一关，掌握度填进度条，满了解锁下一关 + 一个"Boss 关"（混合复习小测）。

### 4.1 Goal → daily quota (the planner)

Inputs: target date `D` (days away), scope = chosen topics, atoms-per-topic `A`, so total new atoms `N`. Current mastered `K` (from FSRS).

```
newPerDay = ceil( (N - K) / (D * 0.8) )        # 0.8 leaves slack for a review tail
if newPerDay > COMFORT_MAX (~15–20):           # scope too big for the timeline
    → warn: extend the date or cut topics
dailyLoad ≈ newPerDay + dueReviews             # dueReviews ≈ newPerDay × ~2–3 at steady state
timePerDay ≈ dailyLoad × ~15–20s
```

**Worked example:** 8 topics × 40 atoms = **320**, interview in **6 weeks (42 days)**, `K=0` → `newPerDay = ceil(320 / 33.6) ≈ 10`. Steady-state daily load ≈ 10 new + ~20 reviews ≈ **30 cards ≈ 6–9 min/day**. If that's too much, extend the date or narrow scope — the planner tells you *before* you fall behind.

### 4.2 Daily task

`todayQueue = dueByFSRS(today) ++ take(newCards, newPerDay)`. Auto-generated, no manual config — the "customized daily task" from your first idea is this queue.

### 4.3 Gamification as a thin layer (not an engine)

Everything below is a pure function of the local session log + FSRS state:

- **XP** — `+10` correct on first try, `+4` after "unsure→review", small bonus for `code`/`chain` cards. Just a running number.
- **Streak** — consecutive days the daily queue was cleared.
- **闯关 Levels** — each **topic = a level (关)**; a progress ring fills with `% atoms mastered` (FSRS stability past a threshold); crossing e.g. 80% unlocks the next topic **and** a **Boss 关**.
- **Boss 关 (the "祖玛/连连看" energy, done right)** — a short timed **mixed-review quiz** drawn from that topic's mastered atoms (spaced retrieval). It's content, not a physics minigame — reuses the same cards, adds a timer + combo score.

This gives the百词斩 dopamine loop with **zero** extra content and no game engine to build.

---

## 5. Data model additions

> **速读** ｜ 在卡片之外加几张本地表：目标、每日刷题记录、XP/连续天数/每主题进度，以及每张卡的"来源"（哪章/哪条反馈生成的，给 Mode 2 用）。

```jsonc
// goal
{ "targetDate": "2026-08-15", "topics": ["databases","caching"], "newPerDayCap": 12, "createdAt": "..." }

// sessionLog (one row per day)
{ "date": "2026-07-01", "cardsSeen": 28, "correct": 22, "newCount": 10, "dueCount": 18, "msSpent": 420000 }

// progress
{ "xp": 1240, "streak": 6, "lastStudyDate": "2026-07-01",
  "perTopic": { "databases": { "mastered": 22, "total": 40 } } }

// card provenance (added to each card, powers the feedback loop)
{ "source": { "provider": "hello-interview", "ref": "Databases" }, "generatedBy": "source|feedback", "createdAt": "..." }
```

---

## 6. Tech stack decisions

> **速读** ｜ 学习端：Expo + expo-sqlite + ts-fsrs + expo-speech + expo-notifications，纯本地。生产端：一个 Node/TS 脚本用 @anthropic-ai/sdk + 结构化输出，默认 Opus 4.8。全项目一种语言 (TypeScript)。不为它引入 LangChain / 后端 / 数据库服务。

| Concern | Choice | Note |
|---|---|---|
| Study app | **Expo (React Native + TS)** | runs on your phone via Expo Go, no App Store |
| Local storage | `expo-sqlite` | cards + FSRS state + goal + logs; fully offline |
| Spaced repetition | `ts-fsrs` | the retention engine |
| TTS 🔊 | `expo-speech` | English restatement |
| Reminders | `expo-notifications` | daily nudge |
| Generation (authoring) | **Node/TS script + `@anthropic-ai/sdk`** | same language as the app; structured output via `zodOutputFormat` |
| Generation model | **`claude-opus-4-8`** | correctness matters; `claude-haiku-4-5` for cheap bulk |
| Secret | `ANTHROPIC_API_KEY` env var | authoring machine only; never in the app/repo |
| Scale (later) | Batches API + prompt caching | 50% off bulk; cache the taxonomy prefix |
| **Not using** | ~~LangChain~~, ~~backend server~~, ~~hosted DB~~ | single structured call + local-first make them unnecessary |

---

## 7. Build order (revised)

> **速读** ｜ M0 内容（已在做）→ M1 核心循环 app → M2 规划器 + 闯关 → M3 生成脚本（**这里才第一次需要 key**，含两种模式 + 结构化输出）→ M4 上 Batches/缓存扩量。key 直到 M3 才出现。

- **M0 · Content (in progress)** — hand-authored DB cards + the drill prototype. No key.
- **M1 · Core loop app** — Expo renders `cards.json` → answer → why → 🔊 → `ts-fsrs`. No key.
- **M2 · Planner + gamification** — goal→quota, daily queue, XP/streak/levels/boss. No key.
- **M3 · Generation script** — Option B: `ANTHROPIC_API_KEY`, structured output, Mode 1 + Mode 2. **First and only place the key appears.**
- **M4 · Scale** — Batches for bulk chapters, prompt caching for the taxonomy prefix.

---

## 8. Open questions & risks

> **速读** ｜ ①key 保管（个人机器环境变量；app 永不打包 key）②成本很小但可用 count_tokens 预估 ③LLM 在主观 SD 判断上会出错——人工审校（你 + Mode 2 反馈）留在环里 ④Opus 质量 vs Haiku 成本的取舍。

1. **Key custody** — env var on your machine only; if Atoms ever ships to others, generation stays offline/server-side and the app still ships without a key.
2. **Cost** — negligible for personal use; use `client.messages.countTokens(...)` to estimate before a big batch.
3. **Content correctness** — the model can be wrong on subjective trade-offs; your review + the Mode-2 feedback loop are the safety net. Don't auto-import unreviewed cards.
4. **Model tradeoff** — Opus 4.8 for authoring quality; drop to Haiku/Sonnet only if bulk cost ever matters.
