export const meta = {
  name: 'atoms-build-smalltalk',
  description: 'Build ~40 interview-English / small-talk drill cards from Ashlyn\'s real transcripts',
  phases: [
    { title: 'Write', detail: 'one agent per situation category, grounded in real transcript moments' },
    { title: 'Verify', detail: 'validate decks, wire track, rebuild bundle' },
  ],
}

const ROOT = '/Users/yixuanliang/interview/Job_Search/system design learning/atoms-app'

const CATS = [
  { key: 'greetings-reciprocity', name: '开场问候与回敬', n: 8,
    focus: `The opening "How are you / How's your day / Happy Tuesday / good morning" exchange and reciprocity. Her real replies here are flat ("I'm good too", "I'm pretty [cut off]", "Okay sounds good" to a warm opener). Teach the pattern: acknowledge → answer with ONE light concrete detail → bounce the question back warmly. Include the real Gamma "my cat started yelling" moment and the Amazon "Happy Tuesday" moment.` },
  { key: 'location-logistics', name: '定位与后勤问答', n: 6,
    focus: `"Where are you located / calling from", "just to verify your current role/company", timezone. Her real replies are terse ("Yes.", "I'm now in Bay Area."). Teach: answer + a tiny bit of warmth/color, and how to smoothly confirm current-role facts without sounding like a form. Keep it natural, not over-stuffed.` },
  { key: 'search-status-chitchat', name: 'Search 近况与闲聊过渡', n: 7,
    focus: `"How's your job search going? Any onsites?", "How was your weekend?", weather, "what made you reach out to us". Her real replies ramble or echo the question ("How's my job searching? I start, I start applying..."). Teach: a crisp, positive, non-desperate status line; not echoing the question; a light weekend/hobby detail (she mentioned hiking — usable); turning "why reach out" into a genuine one-liner.` },
  { key: 'tell-me-about-yourself', name: '自我介绍开场', n: 8,
    focus: `"Can you tell me a little about your background / walk me through yourself". Her real openers are grammatically shaky under pressure ("I'm a software engineer who now work at TikTok, right now, and I TikTok..."). Teach a clean 3-beat spoken structure: now (role+company+scope) → 1 signature achievement with a number → what I'm looking for / why this conversation. Keep options showing a rambling version, a too-humble version, a memorized-robotic version, and the clean one.` },
  { key: 'closing-questions', name: '结尾:提问与收尾', n: 8,
    focus: `The close: "Any questions for me?", "next steps / when you'll hear back", "don't hesitate to reach out", graceful sign-off. Her real replies are flat ("Okay. Sounds good.", "Okay, have a good day."). Teach: always having 1-2 real questions ready (process, team, what success looks like), a warm confident sign-off, and how to ask about timeline/next-steps without sounding anxious. Use the real Assembled "curious about the interview process" and Pinpoint "your range" moments.` },
  { key: 'transitions-recovery', name: '过渡句与救场', n: 4,
    focus: `General spoken micro-skills that recur: buying time gracefully ("That's a great question, let me think for a sec"), transitioning into technical talk, recovering from a stumble/mishearing without freezing, and acknowledging an interviewer's comment (their cat, being late, "happy Friday") warmly. These are transferable phrase patterns, lightly grounded in her real freezes.` },
]

function taskPrompt(cat, idx) {
  return `You write ${cat.n} SPOKEN-ENGLISH drill cards for Ashlyn Liang's "atoms" app — a NEW track that
trains interview small talk, her self-identified weak spot. Category: **${cat.name}** (${cat.key}).

WORKING DIRECTORY: ${ROOT}

HER PROFILE: mid-level backend engineer, ~4 yrs, TikTok + Meta, based in the Bay Area, goes by "Lisa"
in calls. English is fluent but her SMALL TALK is flat and stiff under pressure — she under-
reciprocates, gives one-word answers to warm openers, echoes questions back, and stumbles
grammatically when caught off guard. These cards fix that.

STEP 1 — read the REAL MATERIAL: ${ROOT}/reports/smalltalk-material.json
  A JSON array of real moments from her 35 recorded interviews: {company, type, pos (open/mid/close),
  interviewer (what they actually said), your_actual_reply (what SHE actually said — often the weak
  version)}. GROUND YOUR CARDS IN THESE REAL MOMENTS. Her actual weak reply is the perfect basis for
  a distractor. Do not invent interviews that didn't happen; you may lightly clean transcription
  noise, but keep the situation real.

STEP 2 — read the format template: open any file in ${ROOT}/src/content/interview-drill/ and copy
  its card shape EXACTLY (same fields). Also skim ${ROOT}/docs/card-quality-rubric.md for the field
  bar. Key facts about the schema:
   - "format":"mcq", "atomType":"fit", "topic":"interview-english", "sub":"${cat.key}".
   - id: "ien-${cat.key}-001" ... increment, zero-padded 3 digits. Unique.
   - scenario (中文, ≤90字): the real situation — name the company/context and quote the
     interviewer's line so the card is answerable alone. scenario_en: the same in natural English,
     quoting what the interviewer said.
   - q (中文): "你会怎么回应？" style — a specific spoken-response choice. q_en: natural English.
   - options: 4 candidate RESPONSES **in spoken English** (this is the point — she'll read them aloud).
     Exactly one is the natural, warm, native-sounding reply. The 3 distractors are real failure
     modes: (a) her actual flat reply from the material, (b) over-long/rambling, (c) grammatically
     off or oddly formal/robotic. options_en = the same spoken lines (options and options_en can be
     the SAME English strings here since the answers ARE English — that's fine and intended).
   - answer: [index] of the correct one. Vary the correct index across cards (not always the same
     slot — that itself is an answer cue).
   - CRITICAL: the correct option must NOT be the conspicuously longest. Keep all four comparable in
     length; a natural reply is usually SHORT, so make distractors comparably short, not padded.
   - why (中文 ≤2句): name the spoken-English principle the answer embodies — e.g. "接住情绪→答→加一句
     轻松细节→把球弹回"; reciprocity; not echoing the question; a crisp non-desperate status line.
     why_en: one natural spoken sentence.
   - tradeoff: "自然回敬 vs 一字回答" style axis. whenOtherWins: when a shorter/more formal reply is
     actually fine (e.g. a purely logistical yes/no). tags: ["small-talk", "${cat.key}", relevant].
   - optionMeanings/optionMeanings_en, optionScenarioImpacts/_en, optionDirectness/_en: fill per the
     rubric (each wrong option: what it is / when it'd be ok / why it lands flat HERE). One sentence
     each, ≤70 chars. Don't restate why.
   - termDefinitions: usually empty for small talk (no jargon), but if an idiom appears, gloss it.

  FOCUS for this category: ${cat.focus}

STEP 3 — write the cards as a JSON array to: ${ROOT}/src/content/interview-english/${cat.key}.json
  Valid JSON array of ${cat.n} card objects. Nothing else in the file.

STEP 4 — verify:
    cd "${ROOT}" && node scripts/validate-deck.mjs "src/content/interview-english/${cat.key}.json"
    cd "${ROOT}" && node scripts/audit-card-quality.mjs "src/content/interview-english/${cat.key}.json" --limit=0
  Fix until validate passes and there are zero audit findings on your cards (up to 3 passes). Note:
  small-talk cards legitimately have no tradeoff-axis between technical options — but still fill
  tradeoff as the natural-vs-flat axis so the field isn't empty.

Return: {category:"${cat.key}", written (cards written), findings (audit findings remaining, ideally 0),
note (one line: what real moments you grounded them in, or any gap)}.`
}

phase('Write')
const results = await parallel(CATS.map((cat, idx) => () =>
  agent(taskPrompt(cat, idx), {
    label: `write:${cat.key}`,
    phase: 'Write',
    effort: 'high',
    schema: {
      type: 'object',
      properties: {
        category: { type: 'string' },
        written: { type: 'integer' },
        findings: { type: 'integer' },
        note: { type: 'string' },
      },
      required: ['category', 'written'],
    },
  })
))

const done = results.filter(Boolean)
const total = done.reduce((a, r) => a + (r.written || 0), 0)
log(`Wrote ${total} small-talk cards across ${done.length} categories.`)

phase('Verify')
const verify = await agent(
  `Verify and build the new interview-english track for the atoms app. From ${ROOT} run in order:
     node scripts/validate-deck.mjs
     node scripts/audit-card-quality.mjs src/content/interview-english --limit=0 2>&1 | grep -oE '^\\[S[0-9]\\] [a-z_.]+' | sort | uniq -c | sort -rn
     npm run build:deck
   The track wiring (tracks.json + build-deck.mjs DIR_TRACK maps + tracks.json entry named "面试英语")
   is already in place. Confirm: validate passes for ALL decks, report any audit findings on the
   interview-english decks specifically, and confirm build:deck succeeded and its output shows an
   "interview-english" track count > 0. Report the interview-english card count. Do NOT edit card
   files; if build fails, report the exact error.`,
  { label: 'validate + build', phase: 'Verify', effort: 'low' },
)

return {
  categories: done.length,
  cards_written: total,
  per_category: done.map((r) => ({ cat: r.category, n: r.written, findings: r.findings, note: r.note })),
  verify_report: verify,
}
