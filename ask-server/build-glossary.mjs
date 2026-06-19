/**
 * Build the zh→en query-expansion map from the user's own bilingual glossary.
 *
 * The problem this solves, measured before it existed: the study notes are written in
 * English, but she asks in Chinese. BM25 is lexical, so "什么是一致性哈希" scored zero
 * against the "Consistent Hashing" note while the English query found it instantly.
 * Rather than reach for embeddings (a service on the request path, a key, a failure mode),
 * we expand the query using the glossary she already maintains for speaking practice.
 *
 * Source lines look like:  - **consistent hashing** — 一致性哈希,加减节点时... — "..."
 * We keep the English term and every Chinese phrase in its definition segment.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', '..', 'SD 英文口条术语表.md')
const OUT = join(HERE, 'data', 'glossary.json')

const pairs = []
for (const raw of readFileSync(SRC, 'utf8').split('\n')) {
  const m = raw.match(/^\s*[-*]\s*\*\*(.+?)\*\*\s*[—–-]\s*(.+)$/)
  if (!m) continue
  const en = m[1].trim()
  if (!/[a-zA-Z]/.test(en)) continue
  // Definition is the segment before the example sentence (which starts at a quote).
  const def = m[2].split(/[—–]\s*"/)[0]
  // Chinese runs of 2+ chars are the searchable handles; single chars are too generic.
  const zh = (def.match(/[一-鿿]{2,}/g) || []).filter((w) => w.length <= 8)
  if (!zh.length) continue
  pairs.push({ en, zh: [...new Set(zh)] })
}

// zh phrase → the English terms it should pull in
const map = {}
for (const { en, zh } of pairs) {
  for (const w of zh) {
    ;(map[w] ||= []).push(en)
  }
}
// A phrase that maps to many different terms is a filler word, not a handle.
for (const k of Object.keys(map)) {
  map[k] = [...new Set(map[k])]
  if (map[k].length > 3) delete map[k]
}

writeFileSync(OUT, JSON.stringify(map, null, 0))
console.log(`glossary: ${pairs.length} terms → ${Object.keys(map).length} zh handles`)
console.log('sample:', Object.entries(map).slice(0, 5).map(([k, v]) => `${k}→${v[0]}`).join('  '))
