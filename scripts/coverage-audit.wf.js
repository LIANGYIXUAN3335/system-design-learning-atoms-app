export const meta = {
  name: 'atoms-coverage-audit',
  description: 'Per source article: enumerate interview-relevant knowledge points and find which have no card',
  phases: [
    { title: 'Audit', detail: 'one agent per source article: extract points, diff against its deck' },
    { title: 'Synthesize', detail: 'rank the systemic gaps across all articles' },
  ],
}

const ROOT = '/Users/yixuanliang/interview/Job_Search/system design learning/atoms-app'
const SRC = '/Users/yixuanliang/interview/Job_Search/atlas_page_scraper/output/clean'

function taskPrompt(i) {
  return `You audit KNOWLEDGE COVERAGE for ONE source article in Ashlyn's "atoms" interview-drill app.
Her worry, in her words: "我的卡片到底有没有 cover 大部分的知识点?" Your job is to answer that
for your one article, with evidence.

STEP 0 — your assignment:
  Read ${ROOT}/reports/coverage-worklist.json (a JSON array). Take the element at index ${i}.
  It has {track, slug, article_path, deck_path, words, cards}.
  If index ${i} is out of range, return {slug:"", covered:0, missing:[], note:"index out of range"} and stop.

STEP 1 — read the source article at "article_path" IN FULL.
  Enumerate its INTERVIEW-RELEVANT knowledge points. A knowledge point qualifies only if a
  candidate could be asked to APPLY it: a design decision, a tradeoff, a failure mode, a
  mechanism whose steps matter, a constraint that forces an architecture. Skip prose, author
  asides, marketing, and pure trivia. Expect roughly one point per 60-120 words of substantive
  text — a 9,000-word article typically carries 70-120 real points. Do NOT stop at 45: enumerate
  what is actually there, because whether the deck under-covers long articles is the thing being
  measured. List them as short Chinese phrases naming the specific decision/mechanism.

STEP 2 — read the existing cards at "deck_path" (JSON array of cards; look at q/scenario/why/options).

STEP 3 — diff. For each knowledge point, decide: COVERED (some card actually tests it) or
  MISSING (no card tests it). Judge by substance, not keyword overlap — a card that merely
  mentions a term while testing something else does NOT cover that point.
  For every MISSING point, also judge its interview value:
    "high"   = commonly asked / a core tradeoff of this topic
    "medium" = plausible follow-up
    "low"    = nice to know

Return JSON:
{slug, track, points_total (points you enumerated), covered (how many are covered),
 missing (array of {point, value} for EVERY missing point — this is the deliverable, be complete),
 coverage_pct (covered/points_total as an integer percent),
 note (one line: what KIND of material is systematically missing here, e.g. "深挖部分全缺:
 文章后半的 failure modes 和容量估算一张卡都没有")}`
}

phase('Audit')
const N = 122
const results = await parallel(Array.from({ length: N }, (_, i) => i).map((i) => () =>
  agent(taskPrompt(i), {
    label: `coverage #${i}`,
    phase: 'Audit',
    effort: 'high',
    schema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        track: { type: 'string' },
        points_total: { type: 'integer' },
        covered: { type: 'integer' },
        coverage_pct: { type: 'integer' },
        missing: {
          type: 'array',
          items: {
            type: 'object',
            properties: { point: { type: 'string' }, value: { type: 'string' } },
            required: ['point', 'value'],
          },
        },
        note: { type: 'string' },
      },
      required: ['slug', 'points_total', 'covered', 'coverage_pct', 'missing'],
    },
  })
))

const done = results.filter(Boolean)
const pts = done.reduce((a, r) => a + r.points_total, 0)
const cov = done.reduce((a, r) => a + r.covered, 0)
const highMissing = done.flatMap((r) => (r.missing || []).filter((m) => m.value === 'high'))
log(`${done.length} articles: ${cov}/${pts} points covered (${Math.round(cov / Math.max(pts, 1) * 100)}%), ${highMissing.length} high-value gaps.`)

phase('Synthesize')
const worst = done.slice().sort((a, b) => a.coverage_pct - b.coverage_pct).slice(0, 25)
const synth = await agent(
  `You are an expert in curriculum design and technical-interview training. Below is a
per-article coverage audit of a system-design drill app. Find the SYSTEMIC patterns — not a
restatement of the list.

Answer, concretely:
1. Which KINDS of knowledge are systematically missing across articles (e.g. failure modes,
   capacity math, the deep-dive second half, follow-up questions)? Cite article slugs as evidence.
2. Is coverage correlated with article length — i.e. are long articles under-covered? Say so
   with numbers.
3. What are the highest-value gaps to fill first, for someone interviewing for senior backend
   roles in the next few weeks? Give a ranked shortlist with reasons.
4. What should change in how cards are GENERATED so this does not recur?

Data (JSON): ${JSON.stringify(done.map((r) => ({ slug: r.slug, track: r.track, pts: r.points_total, cov: r.covered, pct: r.coverage_pct, note: r.note, high_missing: (r.missing || []).filter((m) => m.value === 'high').map((m) => m.point).slice(0, 12) })))}

Return a tight markdown report in Chinese. Lead with the single most important finding.`,
  { label: 'synthesize gaps', phase: 'Synthesize', effort: 'high' }
)

return {
  articles: done.length,
  points_total: pts,
  points_covered: cov,
  coverage_pct: Math.round(cov / Math.max(pts, 1) * 100),
  high_value_gaps: highMissing.length,
  worst_covered: worst.map((r) => ({ slug: r.slug, pct: r.coverage_pct, note: r.note })),
  report: synth,
}
