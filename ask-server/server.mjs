/**
 * atoms-ask — one question-answering service, two clients.
 *
 *   POST /v1/chat/completions   OpenAI-shaped, for the Even G2 glasses. The glasses'
 *                               "Agent Configuration" only speaks this format, so we
 *                               speak it back rather than asking the glasses to change.
 *   POST /ask                   Plain JSON, for the Atoms app's "ask AI" button.
 *   GET  /health                Liveness + corpus size.
 *
 * Both paths run the same pipeline: retrieve from the baked corpus (4,233 records of the
 * user's own study notes and practice cards), then answer with Claude grounded in what
 * was retrieved. The answer is written for a 576x288 monochrome HUD — short, plain text,
 * no markdown — because that is the harder of the two displays and it reads fine in the app.
 *
 * Secrets: ANTHROPIC_API_KEY and ASK_TOKEN come from the environment (Secret Manager in
 * Cloud Run). Nothing secret is baked into the image.
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Index, buildContext, setGlossary } from './lib/retrieve.mjs'
import { ClarificationReviewer, ReviewRateLimitError, ReviewRequestLedger } from './clarification-review.mjs'
import { readBody } from './request-body.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 8080)
const API_KEY = process.env.ANTHROPIC_API_KEY || ''
const ASK_TOKEN = process.env.ASK_TOKEN || ''
const MODEL = process.env.ASK_MODEL || 'claude-sonnet-5'
const API_URL = 'https://api.anthropic.com/v1/messages'
const ALLOWED_ORIGINS = new Set(
  String(process.env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean),
)

// A key that isn't ASCII can never be sent as an HTTP header — fetch throws
// "Cannot convert argument to a ByteString", which says nothing about the real cause.
// This happened for real: the deploy script printed a copy-pasteable command containing a
// Chinese placeholder, and the placeholder got stored as the secret. Fail loudly instead.
const KEY_PROBLEM = (() => {
  if (!API_KEY) return 'ANTHROPIC_API_KEY is empty'
  if (!/^[\x20-\x7e]+$/.test(API_KEY)) {
    return 'ANTHROPIC_API_KEY contains non-ASCII characters — it looks like a placeholder '
         + 'was stored instead of a real key. Store the real key: '
         + 'printf %s "<key>" | gcloud secrets versions add anthropic-api-key --data-file=-'
  }
  if (!API_KEY.startsWith('sk-ant-')) return 'ANTHROPIC_API_KEY does not start with sk-ant-'
  return ''
})()
if (KEY_PROBLEM) console.error(`[ask] CONFIG ERROR: ${KEY_PROBLEM}`)

const records = readFileSync(join(HERE, 'data', 'corpus.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l))
setGlossary(JSON.parse(readFileSync(join(HERE, 'data', 'glossary.json'), 'utf8')))
const index = new Index(records)
console.log(`[ask] corpus ${records.length} records indexed`)
let clarificationRubrics = []
try {
  clarificationRubrics = JSON.parse(readFileSync(join(HERE, 'data', 'clarification-rubrics.json'), 'utf8'))
} catch {
  // Older deployments can still answer normal /ask requests while the new app
  // falls back to its manual checklist rather than receiving a broken review.
  console.warn('[ask] clarification rubrics unavailable')
}
const clarificationRubricByCardId = new Map(
  clarificationRubrics.filter((item) => item?.cardId && item?.version).map((item) => [item.cardId, item]),
)
const clarificationReviewer = new ClarificationReviewer({ apiKey: API_KEY, model: process.env.COPILOT_REVIEW_MODEL || MODEL })
const clarificationRequests = new ReviewRequestLedger()

const SYSTEM = `You answer questions from Casey's own study notes and interview practice cards.

The answer is read on smart glasses: a 576x288 monochrome display, about 9 short lines.
Write for that:
- Lead with the answer. No preamble, no restating the question.
- Plain text only. No markdown, no bullets symbols, no headers, no bold.
- Short lines. Aim for under 60 characters per line so nothing wraps awkwardly.
- Under 90 words total unless the question genuinely needs more.
- Reply in the language the question was asked in. Keep technical terms in English
  even when answering in Chinese - that is how the notes are written and how she says
  them out loud in interviews.

Ground every claim in the provided context. If the context does not cover the question,
say so in one line and answer from general knowledge, clearly marked - never invent a
detail and attribute it to her notes.`

function send(res, code, obj, headers = {}) {
  const body = JSON.stringify(obj)
  res.writeHead(code, { 'content-type': 'application/json', ...headers })
  res.end(body)
}

/** Both clients authenticate the same way; the glasses send it as a Bearer token. */
function bearer(req) {
  const h = req.headers.authorization || ''
  return h.startsWith('Bearer ') ? h.slice(7) : ''
}

function authed(req) {
  if (!ASK_TOKEN) return true                      // unset = local dev
  const token = bearer(req)
  return token === ASK_TOKEN || req.headers['x-ask-token'] === ASK_TOKEN
}

/** The browser review endpoint is intentionally restricted to the known app origin. */
function applyCors(req, res) {
  const origin = String(req.headers.origin || '')
  if (!origin) return true // Even G2 and command-line health checks do not send Origin.
  if (!ALLOWED_ORIGINS.has(origin)) return false
  res.setHeader('access-control-allow-origin', origin)
  res.setHeader('vary', 'Origin')
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS')
  res.setHeader('access-control-allow-headers', 'authorization, content-type, x-request-id')
  res.setHeader('access-control-max-age', '600')
  return true
}

async function askClaude(question, { stream = false } = {}) {
  const hits = index.search(question, 8)
  const context = buildContext(hits)
  const user = context
    ? `以下是她自己的笔记和练习卡片：\n\n${context}\n\n---\n\n问题：${question}`
    : `问题：${question}\n\n（没有检索到相关笔记）`

  const body = {
    model: MODEL,
    max_tokens: 700,
    system: SYSTEM,
    messages: [{ role: 'user', content: user }],
    stream,
  }
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`anthropic ${res.status}: ${detail.slice(0, 300)}`)
  }
  return { res, hits }
}

/** Last user message wins — the glasses send the whole conversation for follow-ups. */
function lastUserText(messages) {
  for (let i = (messages || []).length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'user') continue
    if (typeof m.content === 'string') return m.content
    if (Array.isArray(m.content)) {
      return m.content.filter((c) => c.type === 'text').map((c) => c.text).join(' ')
    }
  }
  return ''
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')

  if (!applyCors(req, res)) return send(res, 403, { error: 'forbidden origin' })
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return res.end()
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    return send(res, KEY_PROBLEM ? 503 : 200, {
      ok: !KEY_PROBLEM, records: records.length, model: MODEL,
      hasKey: Boolean(API_KEY), keyProblem: KEY_PROBLEM || undefined,
    })
  }

  if (req.method !== 'POST') return send(res, 404, { error: 'not found' })
  if (!authed(req)) return send(res, 401, { error: 'unauthorized' })
  if (KEY_PROBLEM) return send(res, 503, { error: { message: KEY_PROBLEM } })

  let body
  try {
    body = await readBody(req, url.pathname === '/review/clarifications' ? 8 * 1024 : 64 * 1024)
  } catch (error) {
    return send(res, Number(error?.status) || 400, { error: 'invalid request body' })
  }

  // ── Atoms app: clarification-only Copilot review ─────────────────────
  // The browser never submits a rubric. `cardId + rubricVersion` must match
  // the small rubric bundle baked into this service at deploy time.
  if (url.pathname === '/review/clarifications') {
    const cardId = String(body.cardId || '').trim()
    const rubricVersion = String(body.rubricVersion || '').trim()
    const answer = String(body.answer || '')
    const requestId = String(req.headers['x-request-id'] || '').trim()
    const rubric = clarificationRubricByCardId.get(cardId)
    if (!/^[-a-z0-9_]{8,120}$/i.test(requestId) || !rubric || rubric.version !== rubricVersion) {
      return send(res, 400, { error: 'invalid review request' })
    }
    try {
      const result = await clarificationRequests.run(bearer(req) || 'local-dev', requestId, () =>
        clarificationReviewer.review({ cardId, rubricVersion, answer, requestId, rubric }),
      )
      return send(res, 200, result)
    } catch (error) {
      if (error instanceof ReviewRateLimitError || error?.status === 429) {
        return send(res, 429, { error: 'rate limited' }, { 'retry-after': '600' })
      }
      if (error?.status === 400 || error?.status === 413) return send(res, error.status, { error: 'invalid review request' })
      // Do not log candidates' pasted answer or an upstream provider payload.
      console.error('[clarification-review] unavailable')
      return send(res, 503, { error: 'review unavailable' })
    }
  }

  // ── Atoms app: plain JSON in, plain JSON out ──
  if (url.pathname === '/ask') {
    const q = (body.question || body.q || '').trim()
    if (!q) return send(res, 400, { error: 'question required' })
    try {
      const { res: up, hits } = await askClaude(q)
      const data = await up.json()
      const text = (data.content || []).filter((b) => b.type === 'text')
        .map((b) => b.text).join('').trim()
      return send(res, 200, { answer: text, sources: hits.map((h) => h.cite) })
    } catch (e) {
      console.error('[ask]', e.message)
      return send(res, 502, { error: String(e.message) })
    }
  }

  // ── Glasses: OpenAI chat-completions shape ──
  if (url.pathname === '/v1/chat/completions') {
    const q = lastUserText(body.messages).trim()
    if (!q) return send(res, 400, { error: 'no user message' })
    const id = `chatcmpl-${Date.now().toString(36)}`
    const created = Math.floor(Date.now() / 1000)

    // Non-streaming: one JSON object, the shape an OpenAI client expects.
    if (!body.stream) {
      try {
        const { res: up } = await askClaude(q)
        const data = await up.json()
        const text = (data.content || []).filter((b) => b.type === 'text')
          .map((b) => b.text).join('').trim()
        return send(res, 200, {
          id, object: 'chat.completion', created, model: MODEL,
          choices: [{ index: 0, message: { role: 'assistant', content: text },
                      finish_reason: 'stop' }],
          usage: {
            prompt_tokens: data.usage?.input_tokens ?? 0,
            completion_tokens: data.usage?.output_tokens ?? 0,
            total_tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
          },
        })
      } catch (e) {
        console.error('[chat]', e.message)
        return send(res, 502, { error: { message: String(e.message) } })
      }
    }

    // Streaming: translate Anthropic's SSE into OpenAI's chunk format as it arrives, so
    // text appears on the lens while it is still being written.
    try {
      const { res: up } = await askClaude(q, { stream: true })
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      const chunk = (delta, finish = null) => {
        res.write(`data: ${JSON.stringify({
          id, object: 'chat.completion.chunk', created, model: MODEL,
          choices: [{ index: 0, delta, finish_reason: finish }],
        })}\n\n`)
      }
      chunk({ role: 'assistant', content: '' })

      const reader = up.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (!payload) continue
          let ev
          try { ev = JSON.parse(payload) } catch { continue }
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
            chunk({ content: ev.delta.text })
          }
        }
      }
      chunk({}, 'stop')
      res.write('data: [DONE]\n\n')
      return res.end()
    } catch (e) {
      console.error('[chat/stream]', e.message)
      if (!res.headersSent) return send(res, 502, { error: { message: String(e.message) } })
      return res.end()
    }
  }

  return send(res, 404, { error: 'not found' })
})

server.listen(PORT, () => console.log(`[ask] listening on :${PORT}`))
