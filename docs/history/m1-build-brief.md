# Atoms — Build brief (M1)

> **中文说明（怎么用这份文件）**：这是给 Fable（或任何要动手搭 app 的模型/人）的**自包含**简报。在 VS Code 里对 Fable 说：**「读 `atoms-build-brief.md`，先批判性审一遍设计，再按它搭出可跑的 M1。」** 它列了已经定下的决策，避免冷启动的 Fable 推翻重来或跑偏。Fable 5 在给全目标 + 高 effort 时表现最好——这份简报就是按"一次给全"写的。

---

## What you're building

**Atoms** — a personal iOS study app: a "百词斩 / Duolingo for system design". It drills the user with small cards atomized from Hello Interview / Educative material, using spaced repetition. This is a **personal tool**, not a product.

The full design is in three files in this directory — **read them first**:

- **`atoms-design-doc.md`** — product design (pedagogy). Key sections: §4 the atom taxonomy (fact/fit/contrast/consequence/number + decision chain — this is *how* content is fragmented), §5 question formats, §7 the learning loop, §13 the feedback→generation loop.
- **`atoms-technical-design.md`** — architecture: the two-plane split, the generation subsystem, the gamification/planner subsystem, the stack table, and the milestones.
- **`content/databases-drill.html`** — a **working content prototype** (open it in a browser to try it). The `CARDS` array inside it is the seed question bank (**34 database cards**) and defines the card shape in practice.

## Your task, in order

1. **Critically review the design first.** Surface gaps, risks, contradictions, or anything underspecified. If you disagree with a settled decision below, say so in one line — do **not** silently change it.
2. **Then scaffold a runnable M1 Expo app** implementing the core drill loop (scope below).

## Settled decisions — do NOT re-litigate

- **Platform:** Expo (React Native + **TypeScript**). Runs on the user's iPhone via **Expo Go** (`npx expo start` + scan QR). No App Store, no paid Apple Developer account, **no API key in the app**.
- **Local-first:** `expo-sqlite` holds cards + FSRS state + goal + session logs. No backend, no network at runtime.
- **Spaced repetition:** `ts-fsrs`. The daily queue = due-today + a new-card quota.
- **TTS:** `expo-speech`, reads the English restatement line aloud; also expose a tap/keyboard trigger.
- **Content:** seed from the `CARDS` array in `content/databases-drill.html` — port it to a bundled `cards.json` (or a typed TS module). Formats: `mcq`, `multi`, `cloze`, `chain`, `code`; optional `codeSample`; optional **visual atoms** `diagram` (Mermaid spec) / `table` (Markdown).
- **Visual atoms** render Mermaid (WebView + mermaid.js, or an RN Mermaid lib) — the content stores the Mermaid *spec* (text), the app renders it. No raster images.
- **Gamification/planner** is a *thin layer* over FSRS, not a game engine: goal (target date + topics) → `newPerDay`; XP; streak; topics = 闯关 levels; a "boss" = a timed mixed-review quiz over mastered atoms.
- **NOT using:** LangChain, a backend server, a hosted database.

## M1 scope — build exactly this

- **Screens:**
  - *Today* — the daily queue (due + new), progress.
  - *Card* — renders by `format` (mcq/multi/cloze/chain/code) with the `scenario` shown first when present.
  - *Explanation* (after answering) — `why` (中文) + English restatement + 🔊 button + `whenOtherWins` + optional `codeSample` and/or `diagram`.
- **Interaction:** answer → correctness → explanation → self-grade (记得/模糊/忘了 → `ts-fsrs`) → schedule → next. Include the **"我不知道 / 不确定"** option and the **per-card feedback capture** (flag chips + note + an export) already prototyped in the HTML.
- **Deck:** load the 34 database cards as the initial deck.
- Clean and minimal — no visual clutter.

## Out of scope for M1 (do not build yet)

- AI card generation — that's the offline **authoring plane** (M3); it needs an API key and lives *outside* the app.
- Full gamification polish; standalone (Mac-free) builds; Android.

## Known inconsistency to resolve

The prototype (`databases-drill.html`) uses field names **`en`** (English line) and **`other`** (when-other-wins); the schema in `atoms-design-doc.md` §6 uses **`why_en`** and **`whenOtherWins`**. Pick one canonical naming (recommend the design doc's) and normalize the ported data + types.

## Builder notes

- Docs here are written **English body + Chinese `> 速读` lines** — match that if you add docs.
- User is on **macOS + iPhone**. End your work with the exact run steps: install deps, `npx expo start`, scan the QR in Expo Go.
- Keep secrets out of the repo; M1 has no secrets anyway (no AI).
