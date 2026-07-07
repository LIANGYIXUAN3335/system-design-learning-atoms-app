# Atoms — a System Design micro-drill trainer

> Design doc · working title "Atoms" (placeholder) · status: DRAFT · author: Yixuan · date: 2026-07-01

> **How to read this doc** — The body is written in English (that's the substance). Each section opens with a `> **速读**` blockquote in Chinese so you can skim the whole thing in ~2 minutes and only drop into English where you want detail.
>
> **本文读法**：正文是英文（这是实质内容）；每节开头有一条中文 **速读**，你可以先只扫中文，需要细节时再看英文。

---

## 1. TL;DR

> **速读** ｜ 做一个"系统设计版百词斩"：把 Hello Interview / Educative 的整块内容拆成一个个"知识原子"，用选择题 / 完形填空 / 决策链排序来练。每次只需点一下 + 读一两句"为什么"，配英文朗读 + 间隔重复。目标不是替代白板，而是**低门槛、可坚持地把"做决策的知识底座"练扎实**。

Atoms turns large, monolithic system-design material into a stream of one-tap drills. The unit of practice is not "design Twitter" — it's a single **knowledge atom** (e.g. *"account balances need ACID, so they belong in a relational store"*). You tap one answer, read a 1–2 sentence "why", optionally hear it read aloud in English, and the card is scheduled for spaced review.

The core bet: **interview system-design skill is bottlenecked not on drawing diagrams or phrasing trade-offs, but on having a dense, retrievable vocabulary of small decision facts** — and that vocabulary is exactly what monolithic reading and high-effort whiteboard practice fail to drill with any stickiness.

---

## 2. Problem & motivation

> **速读** ｜ 三个痛点：(1) 系统设计知识是"整块"的，我不知道怎么拆成能刷的小块；(2) 白板 + AI 评分一次输出太多，很快就放弃，没有粘性；(3) 真正难的不是"讲 trade-off"，而是"讲清楚你**为什么这么决策**"——而决策是由很多细碎知识点支撑的。

Three concrete pains, from the learner:

1. **Monolithic knowledge.** Hello Interview / Educative chapters are excellent but come as large, continuous prose. There is no obvious way to break a chapter into small, drillable, repeatable units. *"I don't know how to fragment it"* is the real blocker — so the fragmentation method is the heart of this doc (§4).
2. **Whiteboard practice has no stickiness.** Full-design practice with AI scoring demands too much output per sitting. Activation energy is high, sessions are long, and the habit dies within days. We want the opposite: near-zero activation energy, one tap per card, sessions that fit in 5 minutes.
3. **The hard part is *justifying the decision*, not the trade-off wording.** In a real interview there is no single correct database and no single correct diagram. What's actually assessed is whether you can *justify* a choice — and a justification is assembled from many small facts: *relational → ACID → good for balances; Cassandra → tunable consistency + high write throughput → good for feeds; Redis → in-memory O(1) → good for hot reads*. The skill is retrieving and chaining these fragments under time pressure.

A useful piece of prior art / caution: flashcard-style drilling is well-evidenced for the **fact layer** of engineering (properties, complexities, definitions) but is documented as *weak* for open-ended synthesis. Atoms takes that seriously: it does not pretend to teach whole-system synthesis. It targets the fact layer **and** one layer above it — the *requirement → property → choice → cost → mitigation* decision chain — while leaving true synthesis to whiteboard practice (§3 non-goals).

---

## 3. Goals & non-goals

> **速读** ｜ 目标：低门槛可坚持、练"决策词汇量"、中英双语 + 朗读、间隔重复、个人自用、内容来自 HI/Educative。非目标：不做白板整体设计、不做作文式 AI 评分、不做社交排行榜、不假装从零教学（它是"复习/提取"，配合看 HI/Educative 用）。

**Goals**
- **Stickiness first.** One tap to answer; ≤2 sentence explanation; a session is ~5 min / ~15 cards.
- **Train the decision vocabulary.** Optimize for retrieval of the small facts that *feed* design decisions, and for assembling them into a justification chain.
- **Multi-sensory.** Read (text) + hear (English TTS) + tap (kinesthetic) on every card.
- **Retention via spaced repetition.** Scheduling, not games, is the retention engine.
- **Personal tool.** Single user, offline, no backend. Content sourced from the user's own Hello Interview / Educative subscriptions.

**Non-goals**
- Not a whiteboard / full-design tool. Not an AI essay grader.
- Not a first-exposure teacher. Atoms is **reinforcement + retrieval practice**, meant to run *alongside* reading HI/Educative — not to replace the reading. (See risks, §11.)
- No social features, leaderboards, or heavy game skins in the core product. Rewards stay minimal (streak + per-topic progress).
- Not a content redistribution product. Atoms stores the user's own *paraphrased* fragments for personal study (§9 copyright).

---

## 4. Core insight — how to fragment (the atom taxonomy)

> **速读** ｜ 这是全篇最关键的一节，直接回答"怎么碎片化"。把任何一个系统设计主题拆成 **5 类知识原子**：①事实（组件有什么属性）②适配（需求→决定性属性→选型，**决策的最小单元**）③对比（A vs B 在某维度谁强）④代价（某选择的风险 + 缓解）⑤数量（数量级经验值）。再把它们串成一条**决策链**：需求 → 决定性属性 → 选型 → 代价 → 缓解。单个原子练"词汇"，决策链练"你说的最难的——决策过程"。

Every system-design topic decomposes into five atom types. This taxonomy *is* the fragmentation method: to atomize a chapter, you scan it for instances of these five shapes.

| # | Atom type | 中文 | Shape | Example (databases) |
|---|-----------|------|-------|---------------------|
| 1 | **Fact** | 事实 | Component **has** property | "PostgreSQL provides ACID transactions." |
| 2 | **Fit** | 适配 | Requirement → deciding property → choice | "Balances must not lose updates → needs ACID → relational DB." |
| 3 | **Contrast** | 对比 | A vs B **on a dimension** | "On write scalability, Cassandra > PostgreSQL (masterless, horizontal)." |
| 4 | **Consequence** | 代价 | Choice → risk → mitigation | "Eventual consistency → stale reads → read-your-writes / quorum." |
| 5 | **Number** | 数量 | Order-of-magnitude anchor | "Single Redis node ≈ 100k ops/s; SSD random read ≈ 100 µs." |

**Fit atoms are the center of gravity.** They are the smallest unit of an actual design decision, and they are what most directly trains "why did you pick this". A well-formed fit atom always names four things: the **requirement**, the **deciding property**, the **chosen component**, and at least one **rejected alternative with a why-not**. That structure is what turns "SQL vs NoSQL, it depends" into a defensible, reproducible decision.

### The decision chain (串成决策过程)

> **速读** ｜ 面试里"讲清楚决策"其实是把几个原子按顺序串起来。Atoms 把这条链做成一种题型：给你打乱的步骤，你来排序 / 补全。输出仍然只是"点/拖"，不是写作文——既练了决策过程，又不破坏粘性。

A real justification is an ordered assembly of atoms:

```
 Requirement        Deciding property     Choice           Cost / risk           Mitigation
 需求          ─►    决定性属性     ─►     选型      ─►      代价          ─►      缓解
 "balances must     "ACID / row-level     "PostgreSQL"     "single-primary       "read replicas +
  not lose updates"  locking"                                write ceiling"        shard by account"
```

The decision chain is both a **teaching device** (it shows the learner the *shape* of a good justification) and a **question format** (§5): shuffle the steps and have the user reorder or fill gaps. Crucially this trains the exact skill the learner named as hardest — articulating the decision process — while keeping per-card output to a tap or a drag, preserving stickiness.

### Mining a chapter into atoms

To atomize one Hello Interview / Educative section:
1. Read the section once for the whole picture.
2. Highlight every **property** stated about a component → Fact atoms.
3. Highlight every **"use X when / choose X because"** → Fit atoms (fill in requirement + deciding property + rejected alt).
4. Highlight every **"unlike / compared to / whereas"** → Contrast atoms.
5. Highlight every **"the downside / this means / the risk is"** → Consequence atoms (add the mitigation).
6. Highlight every **number / rule of thumb** → Number atoms.
7. For 1–2 marquee decisions in the section, assemble a **decision chain** from the atoms above.

This is mechanical enough to hand to an LLM as a first pass, then review (§9).

---

## 5. Question formats

> **速读** ｜ 四种题型，对应不同原子和不同认知层级：单选（适配/对比）、多选（"哪些支持 ACID"，事实）、完形填空（事实 + "推理填空"）、决策链排序（决策过程）。每题都配 ≤2 句"为什么" + 一句可朗读的英文总结。

| Format | 中文 | Best for atom | Cognitive level | Output cost |
|--------|------|---------------|-----------------|-------------|
| **MCQ (single)** | 单选 | Fit, Contrast | recognition → judgment | 1 tap |
| **Multi-select** | 多选 | Fact | recall of a set | few taps |
| **Cloze / fill-in-blank** | 完形填空 | Fact; reasoning-cloze for Fit/Consequence | active recall | 1–3 taps |
| **Chain ordering / gap** | 决策链排序 | Decision chain | assembling a justification | drag / order |
| **Code choice** | 代码选项 | Fit (component-level: Redis/CQL/ES/SQL) | reading & choosing real code | 1 tap |

Any card may also carry a `codeSample` — an "实现参考" snippet shown with the explanation, for when you want to see *how* a choice is actually implemented (e.g. `SET … NX EX`, a `CREATE TABLE … CLUSTERING ORDER BY (created_at DESC)`, an Elasticsearch `match` query). This serves the "I want to read the real code, not just prose" need without leaving the drill.

**Visual atoms.** A card may also carry a `diagram` (a compact **Mermaid** spec — `flowchart` / `sequenceDiagram` / `stateDiagram` / ER) or a `table` (Markdown), rendered in the explanation for concepts that are easier to *see*: data flows, state machines, comparison matrices. Mermaid is **text**, so the model emits the diagram *spec* (a few lines) and the app renders it — this keeps the memory-aid visuals cheap in tokens (no raster images; Claude doesn't generate photos and doesn't need to). The `/atomize` skill should add a `diagram` when a concept is inherently spatial/temporal.

Two cloze flavors matter:
- **Fact cloze:** *"PostgreSQL guarantees `___`, `___`, `___`, `___`."* → (A, C, I, D)
- **Reasoning cloze:** *"We chose Cassandra because the workload is `___`-heavy, needs `___` scaling, and tolerates `___` consistency."* → (write, horizontal, eventual). This is where cloze starts training decisions, not just facts.

Every card carries a **≤2-sentence `why`** (shown immediately after answering) and a **single English `why_en` line** wired to text-to-speech.

### The no-single-answer problem (and how grading works)

> **速读** ｜ 系统设计没有唯一答案——但**给定了 scenario 就有**。每道题先给明确需求/约束，答案是"针对这个 scenario 的最优解"，不是抽象的"SQL vs NoSQL"。决策链排序允许多个合法顺序。

The abstract question "SQL or NoSQL?" has no answer. The scenario-constrained question "for account balances with concurrent debits, SQL or NoSQL?" does. So **every Fit card leads with an explicit scenario / requirement**, and grades against *that*. For chain ordering, we grade the **dependencies** (requirement before choice, choice before its cost) and accept multiple valid orderings rather than one canonical sequence.

---

## 6. Content data model

> **速读** ｜ 两层数据：**Atom**（知识碎片本身，含来源）和 **Card**（从原子生成的可作答题目，含 scenario / 选项 / why / 英文朗读句 / SRS 状态）。这也是你"LLM 生成 + 人工审校"的填写模板。

Two entities: **Atom** (the knowledge fragment) and **Card** (a renderable question referencing one or more atoms).

```json
// Atom — a Fit example (the decision-bearing type)
{
  "id": "atom.db.fit.balances",
  "type": "fit",
  "topic": "databases",
  "subtopic": "relational-vs-nosql",
  "requirement": "Account balances with concurrent debits must never lose updates.",
  "decidingProperty": "ACID transactions with row-level locking",
  "choice": "Relational DB (PostgreSQL)",
  "rejected": [
    { "choice": "Cassandra", "whyNot": "eventual consistency risks lost updates on concurrent writes" },
    { "choice": "Redis", "whyNot": "durability/consistency guarantees too weak for money as source of truth" }
  ],
  "tags": ["consistency", "transactions", "money"],
  "source": { "provider": "hello-interview", "ref": "Databases deep-dive", "usage": "personal, paraphrased" }
}
```

```json
// Card — an MCQ generated from the atom above
{
  "id": "card.0001",
  "format": "mcq",
  "atomIds": ["atom.db.fit.balances"],
  "scenario": "A payments app stores user account balances; concurrent debits must never lose updates.",
  "prompt": "Best primary store?",
  "options": ["PostgreSQL", "Cassandra", "Redis", "S3"],
  "answerIndex": 0,
  "why": "Balances need ACID so concurrent debits don't lose updates — a relational DB gives transactional row locking. Cassandra's eventual consistency would risk lost updates.",
  "why_en": "Account balances need ACID transactions so concurrent updates aren't lost, so a relational database is the safe primary store; Cassandra's eventual consistency would risk lost updates.",
  "srs": { "engine": "fsrs" }
}
```

```json
// Card — a reasoning cloze
{
  "id": "card.0002",
  "format": "cloze",
  "atomIds": ["atom.db.fit.feed"],
  "text": "We chose Cassandra for the feed store because the workload is {{c1::write}}-heavy, needs {{c2::horizontal}} scaling, and tolerates {{c3::eventual}} consistency.",
  "why": "Feeds are write-amplified and huge; Cassandra's masterless writes scale horizontally, and a slightly stale feed is acceptable.",
  "why_en": "Feeds are write-heavy and massive, so Cassandra's masterless horizontal writes fit, and eventual consistency is acceptable for a feed."
}
```

```json
// Card — a decision chain
{
  "id": "card.0003",
  "format": "chain",
  "prompt": "Order the reasoning for putting a cache in front of the DB.",
  "stepsShuffled": [
    "Add Redis (in-memory, O(1) reads)",
    "Hot reads are latency-sensitive and repeat",
    "Use TTL + write-through to bound staleness",
    "A cache can serve stale data"
  ],
  "answerOrder": [1, 0, 3, 2],
  "acceptAltOrders": [[1, 0, 2, 3]],
  "why": "Requirement (hot repeated reads) motivates the choice (Redis), which introduces a cost (staleness), which needs a mitigation (TTL / write-through)."
}
```

---

## 7. Learning loop & stickiness

> **速读** ｜ 每日循环 = 到期复习 + 少量新卡；一张卡 = 看题 → 点答案 → 立刻看 ≤2 句 why → 可选 🔊英文朗读 → 打分（忘了/模糊/记得）→ 交给 FSRS 排下次。会话目标 5 分钟 / 15 张。激励很轻：连续天数 + 每主题进度环。粘性来自"低门槛 + 即时反馈"，不是游戏。

One card, one breath:

```
see prompt ─► tap answer ─► instant ≤2-sentence why ─► [🔊 hear English] ─► grade (forgot / fuzzy / got it) ─► FSRS schedules next
```

- **Session target:** ~5 minutes, ~15 cards, mixing *due* (from SRS) + a few *new*.
- **Rewards, minimal:** a streak counter and a per-topic progress ring ("32 / 120 atoms mastered"). Deliberately lighter than Baicizhan's mini-games — the games are a later, optional skin (§10), not the retention mechanism.
- **Multi-sensory on every card:** text (see) + English TTS (hear) + tap/drag (do). The English line doubles as listening + pronunciation practice for the real (English) interview.
- **Why this is sticky where whiteboard isn't:** activation energy is one tap, feedback is immediate, and no card ever demands a paragraph of output.

---

## 8. Spaced repetition engine

> **速读** ｜ 用现成的 FSRS 算法（`ts-fsrs` 库），不要自己造轮子。答完给 3 档评分（忘了/模糊/记得），库算出下次复习日期。每日任务自动生成，不用手动定制——比手动更科学。

Use **FSRS** (Free Spaced Repetition Scheduler) via the `ts-fsrs` library rather than hand-rolling SM-2. Per card: after the `why` is shown, the user grades recall on a 3-button scale (forgot / fuzzy / got it → mapped to FSRS's again/hard–good/easy). FSRS maintains per-card stability + difficulty and returns the next due date. The **daily task is generated, not configured**: `due today` + `N new`. (This replaces the earlier "manually customized daily tasks" idea — automatic scheduling is both less work and more effective.)

---

## 9. Content pipeline

> **速读** ｜ 从 HI/Educative 一个主题 → 原子 → 卡片：①选一个窄主题读完 ②用一个固定 prompt 让 LLM 按 schema 抽成原子草稿 ③你逐条审校修正 ④生成卡片入库。版权：仅个人使用，存**改写后的**碎片+你自己的解释，不存原文、不外传。

Flow for one topic: **pick a narrow topic → read it → LLM extracts atom drafts → you review → generate cards → import JSON.**

**Copyright / usage note.** Content is sourced from the user's *own* paid subscriptions, for *personal* study only. Store **paraphrased** atoms and your own explanations, keep only a lightweight source reference (for your own re-reading), never verbatim copies, and never redistribute. This keeps Atoms firmly in personal-fair-use territory.

**Reusable extraction prompt (paste a section after it):**

```
You are helping me atomize a system-design section into spaced-repetition drill cards.

TASK
1) Extract knowledge "atoms" of these types:
   - fact: a component HAS a property
   - fit: requirement -> deciding property -> chosen component (MUST also list >=1 rejected
          alternative with a why-not)
   - contrast: A vs B on one named dimension
   - consequence: a choice -> its risk -> a mitigation
   - number: an order-of-magnitude anchor / rule of thumb
2) From the atoms, generate cards in formats: mcq, cloze (incl. reasoning-cloze), chain.

RULES
- Paraphrase in your own words; never copy sentences verbatim.
- One idea per atom.
- Every fit card leads with an explicit scenario and is graded against THAT scenario.
- Keep each "why" <= 2 sentences.
- Add 2-4 tags and a single English "why_en" line suitable for text-to-speech.
- Output JSON matching the Atom/Card schema I gave you.

SECTION:
<paste Hello Interview / Educative text here>
```

Review pass (human): fix any atom where the "deciding property" is vague, ensure each Fit has a real rejected alternative, and cut duplicates.

---

## 10. Tech sketch

> **速读** ｜ 技术是次要的（现在不动手）。推荐 **Expo (React Native + TS)**：能直接扫码跑在你自己手机上，不用 $99 苹果账号、不用上架；`expo-speech` 朗读、`expo-sqlite` 本地存、`ts-fsrs` 调度、`expo-notifications` 提醒。纯本地无后端。题库 = 打包进 app 的 JSON。纯 SwiftUI 也行但 iOS-only。

Deliberately thin — this doc is about the *model*, not the build. Recommended stack when the time comes:

| Concern | Choice |
|--------|--------|
| App framework | **Expo (React Native + TypeScript)** — runs on your own phone via Expo Go (no Apple dev account, no App Store review), cross-platform |
| Text-to-speech | `expo-speech` |
| Local storage | `expo-sqlite` (cards + FSRS state) |
| Spaced repetition | `ts-fsrs` |
| Daily reminder | `expo-notifications` |
| Content | a bundled `cards.json` you've reviewed |

Pure **SwiftUI + `AVSpeechSynthesizer`** is a fine alternative if you want native-iOS polish and only use an iPhone, at the cost of Android and slower iteration.

---

## 11. Roadmap

> **速读** ｜ 关键：**内容先行，代码在后**。Milestone 0 完全不写代码——先手工把一个窄主题（数据库选型）拆成 25–30 个原子，验证模型好不好用。然后才做 app 核心循环 → 每日循环 → 决策链 + 抽取流水线 → 扩主题/可选游戏皮肤。

- **M0 — Content spike, no code.** By hand, atomize *one* subtopic ("database selection") into 25–30 atoms + a few decision chains, in the schema, in a JSON/spreadsheet. Answer them yourself on paper. Goal: prove the model produces cards that actually feel worth drilling. This is the real first step and needs no app.
- **M1 — Core loop.** Expo app renders MCQ + cloze from JSON → shows `why` → 🔊 English TTS → 3-button grade → `ts-fsrs`.
- **M2 — Daily loop.** due + new scheduling, streak, per-topic progress ring.
- **M3 — Chains + pipeline.** Chain-ordering format; wire up the extraction prompt to scale content past hand-authoring.
- **M4 — Expand.** More topics (caching, queues, consistency, load balancing); optional game skin.

---

## 12. Open questions & risks

> **速读** ｜ 已知风险：①版权（仅个人用）②它是"复习工具"不是"从零教"——要配合读原文 ③选择题/填空能不能真的迁移到"面试口头表达"？靠决策链题型 + 朗读英文出声来补 ④无唯一答案的判分——靠 scenario 约束 + 决策链允许多解 ⑤内容会过时 ⑥即便有 LLM，审校仍要人力。

1. **Copyright.** Mitigated by personal-use-only + paraphrase-only (§9), but worth staying disciplined about.
2. **Reinforcement, not first exposure.** Atoms assumes you *read* the source; it drills retention. If used as a primary teacher it will produce shallow pattern-matching. Position and use it as a companion to HI/Educative.
3. **Transfer to spoken articulation.** Does tapping MCQs actually make you *say* better justifications out loud? Partial mitigation: the chain format trains ordering of reasoning, and reading the English `why_en` aloud (not just tapping) rehearses the spoken form. Worth validating on yourself after M2.
4. **Grading without a single answer.** Handled by scenario-constrained Fit cards + dependency-based (multi-order) chain grading (§5).
5. **Staleness.** Tech facts drift; keep source refs so atoms can be re-reviewed.
6. **Authoring cost.** Even with LLM extraction, human review is the bottleneck — hence content-first M0 to learn the true per-topic cost before committing to the build.

---

## 13. Feedback-driven generation loop

> **速读** ｜ 新增的核心闭环（你提的）：刷题时的「我不确定 / 术语看不懂 / 太难 / 可能有错 + 具体哪个词 + 笔记」全部被捕获成反馈；批量导出成 JSON 后喂给 AI，**针对你真实的知识缺口生成新卡**（补术语定义卡、把难点拆成更小原子、改错、加深）。于是内容生产从"我坐下来批量造"变成"你的困惑自动驱动"。这让 `/atomize` skill 有了第二种模式。

The drill captures per-card feedback: an explicit **"not sure"** response (honest self-assessment beats a lucky guess, and it keeps the SRS signal clean), plus flags (*term unclear / too hard / too easy / needs more / possibly wrong*), a specific unclear **term**, and a free **note**. Exported as JSON, this feedback becomes the input to a generation pass that produces new cards targeting the learner's *actual* gaps — a definition card for a flagged term (e.g. "wide-column"), smaller atoms decomposing a "too hard" card, a correction for a "possibly wrong" card, or a deeper follow-up.

This gives `/atomize` **two modes**:
- **Mode 1 · Source → cards** — atomize a Hello Interview / Educative chapter (the original pipeline, §9).
- **Mode 2 · Feedback → cards** — take exported drill feedback and generate targeted new / corrected cards.

Why it's better: content generation becomes **demand-driven**. Instead of guessing what to author, the system authors exactly what confused you — and a term you didn't know recursively becomes its own atom (the fragmentation method, §4, applied to your own gaps). It also upgrades "human-in-the-loop" from passive review into an active content *seed*.

Feedback export item shape:

```json
{ "id": "db-003", "sub": "wide-column", "atomType": "fit",
  "q": "...", "grade": "unknown", "flags": ["term"], "term": "wide-column", "note": "" }
```

---

## Appendix A — worked micro-set (databases)

> **速读** ｜ 一个"数据库选型"主题的样例原子集，给你感受一下颗粒度。M0 就是把这个扩到 25–30 条。

- **Fact:** PostgreSQL → ACID; Cassandra → tunable consistency + masterless writes; Redis → in-memory, O(1), single-threaded; DynamoDB → managed, partition-key access, single-digit-ms.
- **Fit:** balances → ACID → PostgreSQL (reject Cassandra: lost updates). / feed fan-out store → horizontal writes + eventual OK → Cassandra (reject PostgreSQL: single-primary write ceiling). / hot session lookups → O(1) in-memory → Redis (reject SQL: disk latency).
- **Contrast:** PostgreSQL vs Cassandra on write scaling → Cassandra. / strong vs eventual consistency → latency/availability vs read-your-writes correctness.
- **Consequence:** eventual consistency → stale reads → quorum / read-your-writes. / cache in front of DB → staleness → TTL + write-through.
- **Number:** Redis single node ≈ 100k ops/s; SSD random read ≈ 100 µs; cross-region RTT ≈ 100 ms.
- **Chain:** hot repeated reads → add Redis → risk of staleness → TTL + write-through.
