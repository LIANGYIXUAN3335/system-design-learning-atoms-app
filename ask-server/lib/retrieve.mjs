/**
 * BM25 retrieval over the baked corpus. No dependencies, no network, no vector store.
 *
 * Why lexical and not embeddings: the corpus is 4,233 records of the user's own study
 * material, queried with the vocabulary it is written in ("consistent hashing", "CAP",
 * "念稿"). BM25 answers in single-digit milliseconds from memory, needs no embedding
 * service on the request path, no API key, and cannot silently fail. SDH has run the same
 * approach against this material since July.
 *
 * Mixed-script tokenizer: Latin words are split on non-alphanumerics; CJK has no spaces,
 * so each character is its own token plus every adjacent bigram — bigrams are what make
 * "一致性" match "一致性哈希" instead of scoring every document containing 性.
 */
const K1 = 1.5
const B = 0.75

/**
 * zh→en query expansion, built from her own bilingual glossary (build-glossary.mjs).
 *
 * Measured problem it fixes: the study notes are written in English, she asks in Chinese,
 * and BM25 is lexical — "什么是一致性哈希" scored zero against the "Consistent Hashing"
 * note, while the English phrasing found it in 0ms. Appending the glossary's English term
 * to the query costs nothing at request time and needs no embedding service.
 */
let GLOSSARY = {}
export function setGlossary(map) { GLOSSARY = map || {} }

export function expand(query) {
  const extra = []
  for (const [zh, ens] of Object.entries(GLOSSARY)) {
    if (query.includes(zh)) extra.push(...ens)
  }
  if (!extra.length) return query
  // Repeated so the matched English term outweighs the Chinese phrasing around it: the
  // term is the precise handle on an English-language corpus, the rest is scaffolding.
  const terms = [...new Set(extra)].join(' ')
  return `${query} ${terms} ${terms} ${terms}`
}

// Question scaffolding that appears in nearly every record — as bigrams these score like
// content words and drowned the real signal (measured: "什么是一致性哈希" returned three
// unrelated cards because 什么/是一 matched everything, outweighing "consistent hashing").
const ZH_STOP = new Set([
  '什么', '么是', '是什', '怎么', '么样', '为什', '什', '如何', '可以', '能不', '不能',
  '一下', '的话', '这个', '那个', '我们', '你们', '就是', '还是', '因为', '所以',
  '需要', '应该', '是否', '有没', '没有', '很多', '一些', '这样', '那样', '时候',
])

export function tokenize(s) {
  const text = (s || '').toLowerCase()
  const out = []
  for (const w of text.match(/[a-z0-9]+/g) || []) out.push(w)
  // Single CJK characters are deliberately NOT tokens: individually they are as common as
  // English letters and they let scaffolding words accumulate score. Bigrams carry the
  // meaning ("一致" + "致性" + "性哈" + "哈希" identifies 一致性哈希; "希" alone identifies
  // nothing).
  const run = text.match(/[一-鿿]{2,}/g) || []
  for (const seq of run) {
    for (let i = 0; i + 1 < seq.length; i++) {
      const bg = seq.slice(i, i + 2)
      if (!ZH_STOP.has(bg)) out.push(bg)
    }
  }
  return out
}

export class Index {
  constructor(records) {
    this.records = records
    this.df = new Map()
    this.tf = []
    this.len = []
    for (const r of records) {
      // Title and section carry the topic name and are short, so they are weighted by
      // repetition rather than by a separate field score — simpler and it tunes well.
      const toks = tokenize(`${r.title} ${r.section} ${r.title} ${r.text}`)
      const counts = new Map()
      for (const t of toks) counts.set(t, (counts.get(t) || 0) + 1)
      this.tf.push(counts)
      this.len.push(toks.length)
      for (const t of counts.keys()) this.df.set(t, (this.df.get(t) || 0) + 1)
    }
    this.avg = this.len.reduce((a, b) => a + b, 0) / Math.max(1, this.len.length)
    this.N = records.length
  }

  search(query, limit = 8) {
    const qt = tokenize(expand(query))
    if (!qt.length) return []
    const scores = new Map()
    for (const t of new Set(qt)) {
      const df = this.df.get(t)
      if (!df) continue
      const idf = Math.log(1 + (this.N - df + 0.5) / (df + 0.5))
      for (let i = 0; i < this.N; i++) {
        const f = this.tf[i].get(t)
        if (!f) continue
        const norm = f * (K1 + 1) / (f + K1 * (1 - B + B * this.len[i] / this.avg))
        scores.set(i, (scores.get(i) || 0) + idf * norm)
      }
    }
    const ranked = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([i, score]) => ({ ...this.records[i], score }))

    // Guarantee both kinds when both exist. The two answer different questions about the
    // same topic — a note explains what consistent hashing IS, her card shows how she says
    // it out loud — and pure score collapses to one kind: cards carry Chinese and English
    // so they outscore the English-only notes on a Chinese query, and vice versa. Reserving
    // a slice for the losing kind costs one or two slots and keeps both voices available.
    const want = Math.max(2, Math.floor(limit / 3))
    const notes = ranked.filter((r) => r.kind === 'note')
    const cards = ranked.filter((r) => r.kind === 'card')
    const picked = []
    const seen = new Set()
    for (const r of [...notes.slice(0, want), ...cards.slice(0, want)]) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      picked.push(r)
    }
    for (const r of ranked) {
      if (picked.length >= limit) break
      if (seen.has(r.id)) continue
      seen.add(r.id)
      picked.push(r)
    }
    return picked.sort((a, b) => b.score - a.score).slice(0, limit)
  }
}

/**
 * Build the context block handed to the model. Capped by characters, not record count:
 * one long note chunk can outweigh six short cards, and the cap is what protects both
 * latency and the token bill.
 */
export function buildContext(hits, maxChars = 12000) {
  const parts = []
  let used = 0
  for (const h of hits) {
    const body = h.text.length > 2600 ? `${h.text.slice(0, 2600)}…` : h.text
    const block = `【${h.cite}】\n${body}`
    if (used + block.length > maxChars) continue
    parts.push(block)
    used += block.length
  }
  return parts.join('\n\n---\n\n')
}
