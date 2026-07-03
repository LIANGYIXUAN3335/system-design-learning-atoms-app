# Atoms card authoring spec (for card-generation agents)

You are authoring spaced-repetition drill cards ("atoms") for a personal system-design study app, from Hello Interview articles the user already owns. Follow this spec exactly. Quality matters: bad distractors or vague explanations make the drill worthless.

## Inputs & outputs

- **Source**: clean Markdown at `/Users/yixuanliang/interview/Job_Search/atlas_page_scraper/output/clean/<topic>/<file>.md`. Read the whole article first.
- **Output**: one JSON file per article at `/Users/yixuanliang/interview/Job_Search/system design learning/atoms-app/src/content/<topic>/<same-stem>.json`. The array is the deck for that article.
  - `<topic>` is one of: `system-design`, `low-level-design`, `ml-system-design`, `ai-coding`.
- After writing, VALIDATE (see bottom). Do not finish until your files pass.

## Card schema (canonical — from src/types.ts)

```ts
interface Card {
  id: string;            // see id scheme
  format: 'mcq' | 'multi' | 'cloze' | 'chain' | 'code';
  atomType: 'fact' | 'fit' | 'contrast' | 'consequence' | 'number';
  topic: string;         // the <topic> above
  sub: string;           // short kebab sub-topic, e.g. "eviction", "sharding-strategy"
  scenario?: string;     // REQUIRED for fit mcq/code: the concrete requirement being decided
  q: string;             // the question (Chinese)
  options?: string[];    // mcq/multi/code: 3-4 options
  optionDiagrams?: (string | null)[]; // optional Mermaid specs aligned to options; use when choices are architectures/flows
  optionMeanings?: string[];          // optional Chinese: what each option is
  optionScenarioImpacts?: string[];   // optional Chinese: what choosing it means in this scenario
  optionDirectness?: string[];        // optional Chinese: why each option is or is not the most direct answer
  optionMeanings_en?: string[];       // optional English counterparts
  optionScenarioImpacts_en?: string[];
  optionDirectness_en?: string[];
  answer?: number[];     // mcq/code: exactly 1 index; multi: >=1 index; indexes 0-based, in range
  text?: string;         // cloze: contains {{answer}} markers (answer text inside braces)
  steps?: string[];      // chain: the ordered reasoning steps, authored already-shuffled
  answerOrder?: number[];// chain: permutation of 0..steps.length-1 giving the correct order
  acceptAltOrders?: number[][]; // chain: optional other valid orderings
  why: string;           // <=2 sentences, Chinese, shown after answering
  why_en: string;        // ONE English sentence, drives text-to-speech
  whenOtherWins?: string;// fit cards: when the rejected alternative would be the right call
  termDefinitions?: { term: string; meaning: string; meaningEn?: string }[]; // card-local glossary for jargon-heavy cards
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
- **Bilingual**: `q`, `scenario`, `why`, `whenOtherWins` in **Chinese**; `why_en` is **one natural English sentence** (it is read aloud by TTS). `why` ≤ 2 sentences.
- **fit** mcq/code MUST have a `scenario` and a `whenOtherWins` (the rejected-alternative / when-other-wins line).
- **Vary the correct-answer index** across cards (spread across 0..3). Do not always put it at index 1.
- **cloze** must contain at least one `{{...}}`; the text inside braces is the expected answer.
- **chain**: `answerOrder` MUST be a permutation of `0..steps.length-1` (each index exactly once). ≥2 steps.
- **Visual layer is required for visual concepts.** Use `diagram` (Mermaid) whenever the concept is spatial/temporal/structural: data flow, request lifecycle, write path, replication, sharding, leader/follower, queue/worker, state machine, protocol handshake, component-choice flowchart, or architecture trade-off. For deep-dives and problem-breakdowns, target roughly **15-25%** of cards with a visual atom, plus at least one visual early in the deck that teaches the core mental model.
- Use `table` for contrast cards when the learner needs to compare dimensions (e.g. Postgres vs Cassandra, TCP vs UDP, SSE vs WebSocket).
- Use `optionDiagrams` when the answer choices are architectures, flows, or topologies. It must be the same length as `options`; use `null` for text-only choices. Each non-null value is a Mermaid spec for that option. Keep option diagrams small so A/B/C/D remains scannable.
- For important choice cards, add `optionMeanings`, `optionScenarioImpacts`, and `optionDirectness` so every A/B/C/D option teaches what it is, what it implies in the scenario, and why it is more or less direct than the best answer. Avoid shallow "wrong because correct is B" wording.
- Every card needs `why` AND `why_en`.
- Do NOT use legacy field names: `en`, `other`, `opts`, `prompt`, `answerIndex`.
- Cards must be self-contained. Do not ask "this layer", "the article", "the above design", or a bare company fact unless the scenario gives enough context to answer the card in isolation.
- Do not turn article assumptions or benchmark numbers into trivia. If a number matters, ask what design implication follows from that number, or give the number in the scenario and ask for the architectural consequence.
- Distractors should be plausible misconceptions or real alternative designs. Avoid throwaway choices and avoid generic explanations such as "does not fit the requirements".
- For jargon-heavy choice cards, define the term locally in `scenario`, `why`, or per-option fields. A learner should not need the original article open to understand TCP, UDP, WebRTC, DynamoDB, CDC, DLRM, GraphSAGE, GSI, RCU/WCU, fan-out, etc.
- Use `termDefinitions` when the card needs a local glossary entry that the global term detector may not know, especially for product-specific or paper-specific terms.
- Prefer single-best-answer wording for tradeoffs. Many technologies are defensible; the card must say why one option is most direct under the stated constraints, not imply the other technologies are globally wrong.

## id scheme (collision-free — derive mechanically)

`id = "<abbr>-<file-stem-dashed>-<NNN>"`, NNN zero-padded to 3 digits, starting 001, per file.
- `<abbr>`: system-design→`sd`, low-level-design→`lld`, ai-coding→`aic`, llm-sd→`llm`.
- ROUTING NOTE: the scraped **ml-system-design** source articles are authored INTO the `llm-sd` output dir, with `topic: "llm-sd"` and abbr `llm` (they seed the llm-sd track). low-level-design source → `low-level-design` dir, `topic: "low-level-design"`, abbr `lld`. ai-coding source → `ai-coding` dir, `topic: "ai-coding"`, abbr `aic`.
- `<file-stem-dashed>`: the source filename without `.md`, with `_` and any non-alphanumeric replaced by `-`.
- Example: `system-design/deep-dives_kafka.md` → ids `sd-deep-dives-kafka-001`, `sd-deep-dives-kafka-002`, …
- Example: `ai-coding/problem-breakdowns_connect-four.md` → `aic-problem-breakdowns-connect-four-001`, …

This guarantees no collisions with other agents.

## Density & coverage

- Cover EVERY section and concept in the article — don't skimp. Target **~50-80 cards** for a dense article (deep-dives, problem-breakdowns), **~30-50** for shorter overview pages. More is fine if the article is rich; never pad with near-duplicate cards.
- Prefer depth: for a problem-breakdown, atomize the requirements, the core entities/API, the high-level design, each deep-dive, and the key numbers/trade-offs.

## Validate before finishing (must pass)

```bash
cd "/Users/yixuanliang/interview/Job_Search/system design learning/atoms-app"
node scripts/validate-deck.mjs src/content/<topic>/<your-file>.json
```

Fix every error it reports. When all your assigned files validate, report: which files you wrote, card counts per file, and the total.
