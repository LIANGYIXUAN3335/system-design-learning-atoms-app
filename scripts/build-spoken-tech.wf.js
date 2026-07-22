export const meta = {
  name: 'atoms-build-spoken-tech',
  description: 'Spoken-technical-English drill cards: domain vernacular + think-out-loud + structuring answers',
  phases: [
    { title: 'Write', detail: 'agents per layer/domain, grounded in her transcripts + concept vocab' },
    { title: 'Trim+Verify', detail: 'curate small-talk to ~12, rebuild bundle, audit' },
  ],
}

const ROOT = '/Users/yixuanliang/interview/Job_Search/system design learning/atoms-app'

// LAYER 1 — vernacular (say the term like an engineer), one agent per domain area
const L1 = [
  { key: 'vern-distributed', name: '分布式术语口语', area: 'distributed', n: 5 },
  { key: 'vern-storage-db', name: '存储与数据库术语口语', area: 'storage-db', n: 5 },
  { key: 'vern-caching', name: '缓存术语口语', area: 'caching', n: 4 },
  { key: 'vern-queue-stream', name: '队列与流术语口语', area: 'queue-stream', n: 4 },
  { key: 'vern-concurrency', name: '并发术语口语', area: 'concurrency', n: 4 },
  { key: 'vern-scale-reliability', name: '扩展与可靠性术语口语', area: 'scale-reliability', n: 6 },
  { key: 'vern-api-network', name: 'API 与网络术语口语', area: 'api-network', n: 4 },
]

// LAYER 2 — think out loud (connective phrasing), ~30%
const L2 = [
  { key: 'think-buy-time-instinct', name: '缓冲与起手：想边说', n: 8,
    focus: `Buying time gracefully and opening a technical answer while still thinking. The formulas: "Let me think about this for a sec." / "My first instinct is X, but let me check the tradeoff." / "Before I dive in, let me make sure I understand the requirement." / "There are a couple of ways to go here — let me start with the simplest." These REPLACE her real stalls "so so, for the for the, in in". Distractors = her actual stall, a rambling non-committal opener, and an over-formal textbook opener.` },
  { key: 'think-tradeoff-decision', name: '权衡与拍板：说清取舍', n: 8,
    focus: `Verbalizing a tradeoff and committing to a decision out loud, the core of a system-design round. Formulas: "The tradeoff is X versus Y." / "I'd lean toward X because ..." / "That buys us X but costs us Y." / "If Z changes, I'd switch to ...". Her real weakness: "keeping the implementation simple and make the simple and make the system flexible" — she loses the thread. Teach clean tradeoff framing. Distractors = her looping version, a one-sided version that ignores the cost, and a vague version.` },
  { key: 'think-clarify-pushback-uncertain', name: '澄清·反问·认不确定', n: 8,
    focus: `Handling the technical dialogue: asking a clarifying question ("Quick question — are we optimizing for read or write here?"), pushing back politely ("I could be wrong, but wouldn't that add a round trip?"), admitting uncertainty without freezing ("I'm not 100% sure on the exact API, but the shape would be ..."), and self-correcting gracefully ("Actually, let me correct myself — ..."). She freezes or echoes instead. Distractors = freezing/echoing, bluffing a wrong-confident answer, over-apologizing.` },
]

// LAYER 3 — structuring an answer on the spot, ~20%
const L3 = [
  { key: 'struct-project-pitch', name: '项目介绍的结构', n: 8,
    focus: `Structuring a project / "walk me through a hard problem you solved" answer. Her real GMV Max descriptions ramble and lose the thread ("the goal is to help the advertisement to set up campa..."). Teach a clean spoken arc: context (what + scale in one line) → the hard part (the specific constraint) → what you did (your decision) → the result (a number). Frame it like STAR but spoken and tight. Distractors = her rambling version, a too-humble version that buries the achievement, a jargon-salad version with no story.` },
  { key: 'struct-systemdesign-arc', name: '系统设计叙述的骨架', n: 7,
    focus: `Narrating a system-design answer as an arc the interviewer can follow: "Let me start with the requirements and scale." → "Here's the high-level design." → "Let me zoom into the part that matters most — ..." → "The main tradeoffs are ...". Plus narrating a diagram out loud and coding narration ("Let me talk through my approach before I code."). Her real weakness: jumping in without structure, echoing the question. Distractors = diving into details with no frame, echoing the prompt, silent-then-dump.` },
]

const SCHEMA = {
  type: 'object',
  properties: {
    key: { type: 'string' },
    written: { type: 'integer' },
    findings: { type: 'integer' },
    note: { type: 'string' },
  },
  required: ['key', 'written'],
}

function commonRules(key, sub) {
  return `WORKING DIRECTORY: ${ROOT}

HER PROFILE: mid-level backend engineer (TikTok ads platform / Meta), fluent English but her SPOKEN
technical delivery breaks down under interview pressure — wrong term forms ("read pass" for "read
path"), stalls ("so so, for the for the, in in"), losing the thread mid-sentence, echoing the
question. These cards fix "understands it but can't say it".

GROUNDING (read both):
 - ${ROOT}/reports/tech-stumbles.json — 105 real moments from her technical rounds where her spoken
   technical English broke. Use these as the basis for the "wrong" options — the distractor should
   sound like something SHE actually said. Do not invent interviews.
 - ${ROOT}/reports/tech-vocab.json — the domain terms that actually appear in her 10,880 concept
   cards, grouped by area. Ground vernacular cards in these real terms.

FORMAT: copy the card shape EXACTLY from any file in ${ROOT}/src/content/interview-drill/. Skim
${ROOT}/docs/card-quality-rubric.md for the field bar. Fixed fields:
 - "format":"mcq", "atomType":"fit", "topic":"interview-english", "sub":"${sub}".
 - id: "ien-${key}-001"… zero-padded, unique.
 - scenario (中文 ≤90字): the real interview situation — name the round/context so it's answerable
   alone; where relevant, reference the real moment she fumbled. scenario_en: same in natural English.
 - q (中文): a specific "该怎么说出口" question. q_en: natural English.
 - options: 4 candidate SPOKEN lines (English — she reads them aloud). Exactly one is how a strong
   engineer actually says it. The 3 distractors are real failure modes: (a) her actual stumble /
   wrong-term form, (b) rambling/looping, (c) grammatically-off or textbook-robotic. options_en =
   same English strings (that's expected — the answers ARE English).
 - answer:[index], VARIED across cards (not always the same slot). The correct option must NOT be the
   conspicuously longest — keep all four comparable in length; strong spoken answers are usually tight.
 - why (中文 ≤2句): name the transferable principle — the correct term form, or the connective
   formula ("My first instinct is… the tradeoff is…"), or the answer structure. why_en: one natural
   spoken sentence.
 - tradeoff: the "地道口语 vs 卡壳/直译" axis (fill it, don't leave empty). whenOtherWins: when the
   simpler/shorter form is fine. tags: ["spoken-tech","${sub}", the domain].
 - optionMeanings/_en, optionScenarioImpacts/_en, optionDirectness/_en per rubric (1 sentence each,
   ≤70 chars, each wrong option: what it is / when it'd be ok / why it lands wrong HERE). Don't
   restate why. termDefinitions: gloss any real jargon/idiom that appears (fan-out, tail latency,
   idempotent, back-of-the-envelope…) so she can pronounce+define it.

WRITE the cards as a JSON array to: ${ROOT}/src/content/interview-english/${key}.json (only the array).

VERIFY, loop until clean (≤3 passes):
  cd "${ROOT}" && node scripts/validate-deck.mjs "src/content/interview-english/${key}.json"
  cd "${ROOT}" && node scripts/audit-card-quality.mjs "src/content/interview-english/${key}.json" --limit=0
Goal: validate passes, zero audit findings on your cards. Return {key:"${key}", written, findings, note}.`
}

function l1Prompt(cat) {
  return `You write ${cat.n} SPOKEN-VERNACULAR drill cards — teaching Ashlyn to SAY domain terms the way
engineers actually say them out loud. Domain: **${cat.name}** (area "${cat.area}").

Pick the highest-value terms for this area from reports/tech-vocab.json's "${cat.area}" list. For each,
build a card around a real interview need: she wants to express a concept; which spoken line is how an
engineer really says it? Teach the exact term FORM and one natural collocation that proves she knows
the mechanism, not just the word. Anchor at least one card to a real stumble from tech-stumbles.json
for this area (e.g. distributed/storage: her "separate the read pass and the write pass" → "split the
read path from the write path — reads hit a replica, writes go to the primary").

Examples of the bar (don't copy verbatim, generate for this area's real terms):
 - fan-out: ✓ "On write, we fan out the post to each follower's feed." ✗ "we send the post to everybody's list"
 - tail latency: ✓ "p99 tail latency spikes under load." ✗ "the slowest requests get slow"
 - idempotent: ✓ "Make the retry idempotent so a double-submit is a no-op." ✗ "make it so retry doesn't do it twice by accident"

${commonRules(cat.key, cat.key)}`
}

function l23Prompt(cat) {
  return `You write ${cat.n} SPOKEN-DELIVERY drill cards. Category: **${cat.name}** (${cat.key}).

FOCUS: ${cat.focus}

${commonRules(cat.key, cat.key)}`
}

phase('Write')
const jobs = [
  ...L1.map((c) => ({ prompt: l1Prompt(c), label: `L1:${c.area}` })),
  ...L2.map((c) => ({ prompt: l23Prompt(c), label: `L2:${c.key}` })),
  ...L3.map((c) => ({ prompt: l23Prompt(c), label: `L3:${c.key}` })),
]
const results = await parallel(jobs.map((j) => () =>
  agent(j.prompt, { label: j.label, phase: 'Write', effort: 'high', schema: SCHEMA })))

const done = results.filter(Boolean)
const total = done.reduce((a, r) => a + (r.written || 0), 0)
log(`Wrote ${total} spoken-technical cards across ${done.length} decks.`)

phase('Trim+Verify')
const trim = await agent(
  `Rebalance the small-talk slice of the interview-english track down to ~12 highest-value cards, then
build and audit the whole track.
 1. The track now has heavy spoken-technical content plus 6 older small-talk decks
    (greetings-reciprocity, location-logistics, search-status-chitchat, closing-questions,
    tell-me-about-yourself, transitions-recovery, 41 cards total). Small talk should now be ~10% of
    the track. KEEP the ~12 best small-talk cards (the highest-impact first-impression openers and
    closers — e.g. "How are you" reciprocity, "tell me about yourself" clean opener, "any questions"
    close) and DELETE the rest from those JSON files. Never touch card ids you keep; only remove whole
    weak cards. Keep each file valid JSON. Aim ~12 small-talk cards surviving across those decks.
 2. Then from ${ROOT} run: node scripts/validate-deck.mjs ; npm run build:deck ;
    node scripts/audit-card-quality.mjs src/content/interview-english/*.json --limit=0 2>&1 | grep -oE '^\\[S[0-9]\\] [a-z_.]+' | sort | uniq -c | sort -rn
 Report: how many small-talk cards you kept/deleted, the final interview-english card count from
 build:deck output, whether validate passed, and any audit findings on the interview-english decks.`,
  { label: 'trim + build', phase: 'Trim+Verify', effort: 'medium' },
)

return {
  decks_written: done.length,
  spoken_tech_cards: total,
  per_deck: done.map((r) => ({ key: r.key, n: r.written, findings: r.findings, note: r.note })),
  trim_report: trim,
}
