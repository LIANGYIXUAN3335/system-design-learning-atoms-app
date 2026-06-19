/**
 * Build the ask-server's search corpus from the two sources that already exist.
 *
 *   1. SDH's RAG index — 3,897 chunks over 358 study documents (Hello Interview,
 *      hack2hire SD + OOD, educative). Already chunked and cleaned; we only reshape it.
 *   2. The Atoms recite bundle — 336 practice cards, each with the question, the spoken
 *      script, a Chinese gloss, the scoring points, and a why/reference pair.
 *
 * Output: data/corpus.jsonl, one normalized record per line, baked into the container.
 * Updating the knowledge base means re-running this and redeploying — there is no live
 * sync, deliberately: a static file cannot drift, cannot half-fail, and costs nothing.
 *
 * Run: node build-corpus.mjs
 */
import { readFileSync, writeFileSync, createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SDH_CHUNKS = join(HERE, '..', '..', 'System Design Helper', 'rag_index', 'rag_chunks.jsonl')
const ATOMS_BUNDLE = join(HERE, '..', 'recite-server', 'data', 'recite.bundle.json')
const OUT = join(HERE, 'data', 'corpus.jsonl')

const out = []

// ── 1. study notes ───────────────────────────────────────────────────────────
const rl = createInterface({ input: createReadStream(SDH_CHUNKS), crlfDelay: Infinity })
let notes = 0
for await (const line of rl) {
  if (!line.trim()) continue
  let c
  try { c = JSON.parse(line) } catch { continue }
  const text = (c.text || '').trim()
  if (text.length < 40) continue          // headers and stubs carry no answer
  out.push({
    id: c.id,
    kind: 'note',
    title: c.title || '',
    // The heading path is what makes a chunk findable by topic, so it joins the
    // searchable text rather than sitting in metadata only.
    section: [c.section, ...(c.heading_path || [])].filter(Boolean).join(' > '),
    corpus: c.corpus || '',
    text,
    cite: c.title || c.doc_id,
  })
  notes++
}

// ── 2. practice cards ────────────────────────────────────────────────────────
const cards = JSON.parse(readFileSync(ATOMS_BUNDLE, 'utf8'))
let cardCount = 0
for (const c of cards) {
  const q = (c.question || '').trim()
  const script = (c.script || c.script_long || c.script_short || '').trim()
  if (!q && !script) continue
  // A card's value is the whole package — the prompt, what you say, why it works, and
  // the graded points. Flattening them into one searchable body means a question about
  // any one of them finds the card.
  const parts = [
    q && `Q: ${q}`,
    c.question_zh && `题意: ${c.question_zh}`,
    script && `念稿: ${script}`,
    c.script_zh_gloss && `讲法: ${c.script_zh_gloss}`,
    Array.isArray(c.points) && c.points.length
      && `要点: ${c.points.map((p) => p.text).filter(Boolean).join(' / ')}`,
    c.why_q && `为什么: ${c.why_q}`,
    c.why_ref && `依据: ${c.why_ref}`,
  ].filter(Boolean)
  out.push({
    id: `atoms:${c.id}`,
    kind: 'card',
    title: q.slice(0, 90) || c.interview || c.id,
    section: [c.interview, c.kind].filter(Boolean).join(' > '),
    corpus: 'atoms',
    text: parts.join('\n'),
    cite: `Atoms 卡片 ${c.id}${c.interview ? ` · ${c.interview}` : ''}`,
  })
  cardCount++
}

writeFileSync(OUT, out.map((r) => JSON.stringify(r)).join('\n') + '\n')
const bytes = readFileSync(OUT).length
console.log(`corpus: ${out.length} records (${notes} note chunks + ${cardCount} atoms cards)`)
console.log(`wrote ${OUT} — ${(bytes / 1e6).toFixed(1)} MB`)
