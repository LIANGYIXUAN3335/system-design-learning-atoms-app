// atoms-recite —— 念稿练习的状态 / 录音 / 评分服务（M4 §3.3）。
// 和 atoms-sync 同一技术栈：裸 node:http、ESM、无框架、bearer token 来自 ATOM_SYNC_TOKEN。
//
// 路由见 M4 §3.3。评分是**可选**的：上传只存盘，`rescore` 才跑 STT + 判官（和 jobscan v2 一致）。
// **绝不吃掉一次录音**：上传先落盘再做别的；STT/判官任一环挂掉都返回 {judge_error} 且 take 已存。

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as R from './lib/recite.mjs';
import { makeStore, newTakeId } from './lib/store.mjs';
import { makeMedia, guessType } from './lib/media.mjs';
import { makeStt } from './lib/stt.mjs';
import { makeJudge } from './lib/judge.mjs';
import { audio_metrics } from './lib/metrics.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.RECITE_DATA_DIR || path.join(HERE, 'data');
const MAX_BODY = 30 * 1024 * 1024; // 30 MB
const ITEM_ID_RX = /^[a-z0-9:_-]{1,80}$/;
const AUDIO_TYPES = ['audio/webm', 'audio/mp4', 'audio/m4a', 'audio/x-m4a'];

// ---------------------------------------------------------------- 内容

function loadJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
  } catch (e) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing ${path.join(DATA_DIR, name)} — run ./sync-content.sh`);
  }
}

const ITEMS = loadJson('recite.bundle.json');
const NUMBERS = loadJson('recite.numbers.json', { allowed: [], banned_phrases: [] });
const BY_ID = new Map(ITEMS.map((it) => [it.id, it]));
const CFG = {}; // recite.py 的 cfg["recite"] 覆写位。云上目前用 _DEFAULTS。

// scored / extra：bundle 里已经预算好（scored_idx / extra_idx），服务端不重算。
// 重算的**正确性**由 test/recite.test.mjs 对全部 336 条断言（scored_cues ≡ scored_idx）。
function itemView(it) {
  return {
    ...it,
    points: it.points || [],
    scored: (it.scored_idx || []).map((i) => it.points[i]).filter(Boolean),
    extra: (it.extra_idx || []).map((i) => it.points[i]).filter(Boolean),
  };
}

// ---------------------------------------------------------------- HTTP 小工具

function cors(res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'authorization,content-type,x-recite-meta');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-expose-headers', 'content-range,accept-ranges');
}

function json(res, status, body) {
  cors(res);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readBody(req, cap = MAX_BODY) {
  const chunks = [];
  let n = 0;
  for await (const chunk of req) {
    n += chunk.length;
    if (n > cap) {
      const e = new Error('body too large');
      e.status = 413;
      throw e;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(req) {
  const raw = await readBody(req, 1024 * 1024);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    return {};
  }
}

function baseUrl(req, env) {
  if (env.PUBLIC_BASE_URL) return env.PUBLIC_BASE_URL.replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

async function streamMedia(req, res, media, name) {
  const st = await media.stat(name);
  if (!st) return json(res, 404, { error: 'not found' });
  const type = st.contentType || guessType(name);
  const range = req.headers.range;
  const m = /^bytes=(\d*)-(\d*)$/.exec(range || '');
  cors(res);
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : st.size - Number(m[2]);
    let end = m[2] && m[1] ? Number(m[2]) : st.size - 1;
    start = Math.max(0, Math.min(start, st.size - 1));
    end = Math.max(start, Math.min(end, st.size - 1));
    res.writeHead(206, {
      'content-type': type,
      'content-length': end - start + 1,
      'content-range': `bytes ${start}-${end}/${st.size}`,
      'accept-ranges': 'bytes',
    });
    if (req.method === 'HEAD') return res.end();
    return media.stream(name, { start, end }).on('error', () => res.end()).pipe(res);
  }
  res.writeHead(200, {
    'content-type': type,
    'content-length': st.size,
    'accept-ranges': 'bytes',
  });
  if (req.method === 'HEAD') return res.end();
  return media.stream(name).on('error', () => res.end()).pipe(res);
}

// ---------------------------------------------------------------- 评分链

/** web.py::_score_take 的移植：STT → 指标 → 判官 → 硬门/软分 → 晋降箱。 */
async function scoreTake(ctxDeps, take_id) {
  const { store, media, stt, judge } = ctxDeps;
  const row = await store.getTake(take_id);
  if (!row) {
    const e = new Error('no such take');
    e.status = 404;
    throw e;
  }
  const it = itemView(BY_ID.get(row.item_id));
  const dur = Number(row.dur_sec || 0);
  const gcsUri = media.gcsUri(row.audio);
  const useBatch = dur > 60 && Boolean(gcsUri);
  const bytes = useBatch ? null : await readStream(media.stream(row.audio));
  const asr = await stt.transcribe({ bytes, gcsUri, duration_sec: dur });

  const transcript = asr.text || '';
  const metrics = audio_metrics({ duration_sec: dur, words: asr.words || [] });
  Object.assign(metrics, R.filler_counts(transcript));
  metrics.wpm = R.wpm(transcript, metrics);
  metrics.asr_engine = asr.engine || '';
  metrics.asr_error = asr.error || '';

  // 版本（她 2026-09-03 定的）：base = 原稿；short = 1–2 分钟分点 STAR；long = 3–5 分钟。
  // 稿子和目标时长都跟着版本走；bundle 里没有对应版本就退回 base。
  const ver = versionOf(it, row.version);
  const script = ver.script;
  const it_v = { ...it, target_sec: ver.target_sec };
  const r = R.verbatim_ratio(transcript, script);
  const prev = await R.prev_transcript(store, it.id, take_id);
  const r_prev = prev ? R.verbatim_ratio(transcript, prev) : null;

  const cfg_r = R.cfg_recite(CFG);
  const calib = await R.calibrating_now(store, CFG);
  const vt = row.variant_type || 'original';
  const n_para = await store.countTakes({ variant_type: 'paraphrase' });

  const review = await judge.reviewTake({
    // 判官看到的必须是**这一次实际问她的**那个问题：变体档下答原问是 structure 失败，
    // 不是 coverage 成功，而这个区分只有在 prompt 里问对了问题时才成立。
    question: row.variant || it.question || '',
    scored_cues: it.scored.map((c) => c.text),
    delivery_notes: (it.delivery_notes || []).slice(0, 1),
    script,
    transcript,
    metrics,
    target_sec: it_v.target_sec,
    wpm: metrics.wpm,
    variant_type: vt,
    variant_sec: row.variant_sec,
    // DEVIATION: jobscan 把 variant_hint 塞在 recite_takes.gate_note 列里（建表时没留列）。
    // Firestore 里有正经字段，这里直接用它。
    variant_hint: row.variant_hint || '',
    why_line: row.why_line,
    why_q: it.why_q,
    speaker_name: it.speaker_name,
    pace: it.pace,
  });

  const checks = R.fact_check(transcript, it, NUMBERS);
  const res = R.judge_take({
    cfg_r,
    item: it_v,
    points: it.points,
    scored: it.scored,
    transcript,
    metrics,
    review,
    why_line: row.why_line || '',
    variant_type: vt,
    variant_sec: parseInt(row.variant_sec || it_v.target_sec || 60, 10),
    mode: row.mode || 'recall',
    first_exposure: Boolean(row.first_exposure),
    box: parseInt(((await store.getState(it.id)) || R.default_state(it.id)).box || 1, 10),
    calibrating: calib,
    r,
    n_paraphrase_takes: n_para,
    number_flags: R.number_flag_strings(checks),
  });

  await store.updateTake(take_id, {
    transcript,
    metrics,
    verbatim_ratio: r,
    r_prev,
    scores: review.scores,
    red_flags: res.red_flags,
    missed_cues: res.missed_cues,
    fact_check: checks,
    fix_next: review.fix_next,
    one_line: review.one_line,
    verdict: res.verdict,
    judge_raw: {
      raw: review.raw, fixed: review.fixed, error: review.error,
      issues: review.issues, evidence: review.evidence,
    },
    passed: res.passed,
    dur_sec: metrics.duration,
    coverage: res.coverage,
    total: res.total,
    hard_ok: res.hard_ok,
    gate_note: res.gate_note,
  });

  const today = R.today();
  const sameDay = (await store.listTakes(it.id))
    .some((t) => t.take_id !== take_id && String(t.ts || '').slice(0, 10) === today);

  const st = await R.apply_outcome(store, cfg_r, it.id, {
    passed: Boolean(res.passed),
    first_exposure: Boolean(row.first_exposure),
    variant_type: vt,
    same_day: sameDay,
    hard_red: Boolean(res.red_flags.length),
    demotes_on_fail: res.demotes_on_fail,
    total: Number(res.total),
    fix_next: review.fix_next,
  });
  if (row.first_exposure) await store.setState(it.id, { exposed: 1, exposure_stage: 4 });

  return {
    take_id,
    transcript,
    metrics,
    verbatim_ratio: r,
    r_prev,
    fact_check: checks,
    scores: review.scores,
    issues: review.issues,
    evidence: review.evidence,
    fix_next: review.fix_next,
    one_line: review.one_line,
    judge_error: review.error,
    state: st,
    calibrating: calib,
    ...res,
  };
}

function readStream(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

// ---------------------------------------------------------------- 路由

export async function makeServer(env = process.env) {
  const store = await makeStore(env);
  const media = await makeMedia(env);
  const stt = makeStt(env);
  const judge = makeJudge(env);
  const deps = { store, media, stt, judge };
  const token = env.ATOM_SYNC_TOKEN;
  // `<audio src>` 带不了 header —— 媒体 URL 里必须带 token（M4 §3.3），且必须是绝对地址。
  const mediaUrl = (req, tail) => `${baseUrl(req, env)}/media/${tail}?token=${encodeURIComponent(token || '')}`;

  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname);

    if (req.method === 'OPTIONS') {
      cors(res);
      res.writeHead(204);
      return res.end();
    }
    // Cloud Run 的前端会把 /healthz 截走（返回 Google 404，请求到不了容器），所以用 /health。
    if (p === '/health' || p === '/healthz') return json(res, 200, { ok: true });

    const isMedia = p.startsWith('/media/');
    const ok = isMedia
      ? token && url.searchParams.get('token') === token
      : token && req.headers.authorization === `Bearer ${token}`;
    if (!ok) return json(res, 401, { error: 'unauthorized' });

    // ── 媒体透传 ────────────────────────────────────────────────
    if (isMedia) {
      const rest = p.slice('/media/'.length);
      const slash = rest.indexOf('/');
      const slot = slash < 0 ? rest : rest.slice(0, slash);
      const name = slash < 0 ? '' : rest.slice(slash + 1);
      if (slot === 'orig' || slot === 'dialog') {
        const id = name.replace(/\.mp3$/, '');
        if (!ITEM_ID_RX.test(id) || !name.endsWith('.mp3')) return json(res, 400, { error: 'bad name' });
        return streamMedia(req, res, media, `${slot}/${id}.mp3`);
      }
      if (slot === 'take') {
        const take = await store.getTake(name);
        if (!take || !take.audio) return json(res, 404, { error: 'no take audio' });
        return streamMedia(req, res, media, take.audio);
      }
      return json(res, 400, { error: 'bad slot' });
    }

    // ── GET /recite/overview ────────────────────────────────────
    if (req.method === 'GET' && p === '/recite/overview') {
      const day = R.today();
      const states = {};
      for (const s of await store.listStates()) states[s.item_id] = s;
      const state = {};
      for (const it of ITEMS) state[it.id] = { ...R.default_state(it.id, day), ...(states[it.id] || {}) };

      const takes = await store.listTakes();
      const n_takes = {};
      for (const t of takes) n_takes[t.item_id] = (n_takes[t.item_id] || 0) + 1;

      const stale = [];
      const queue = R.today_queue(ITEMS, states, CFG, {
        day,
        onReset: (ids) => stale.push(...ids),
      });
      for (const id of stale) await store.setState(id, { due_on: day });
      for (const id of stale) state[id].due_on = day;

      const groups = new Map();
      for (const it of ITEMS) {
        if (!it.link_group) continue;
        groups.set(it.link_group, [...(groups.get(it.link_group) || []), it.id]);
      }
      const dupes = [...groups.values()].filter((ids) => ids.length > 1).flat();

      return json(res, 200, {
        today: day,
        calibrating: await R.calibrating_now(store, CFG, { day }),
        queue_ids: queue.map((q) => q.item_id),
        state,
        n_takes,
        hist: R.histogram(takes),
        dupes,
      });
    }

    // ── /recite/items/:id[/take|/mark|/exposure] ────────────────
    let m = /^\/recite\/items\/([^/]+)(?:\/(take|mark|exposure))?$/.exec(p);
    if (m) {
      const id = m[1];
      const action = m[2];
      if (!ITEM_ID_RX.test(id)) return json(res, 400, { error: 'bad item id' });
      const it = BY_ID.get(id);
      if (!it) return json(res, 404, { error: 'no such recite item' });

      if (!action && req.method === 'GET') {
        const day = R.today();
        const st = { ...R.default_state(id, day), ...((await store.getState(id)) || {}) };
        const takes = await store.listTakes(id, 10);
        return json(res, 200, {
          state: st,
          n_recorded: (await store.listTakes(id)).length,
          variant: R.variant_for(it, parseInt(st.n_takes || 0, 10)),
          // 曝光轮由 state.exposed 显式驱动，**不从 n_takes 推导**：录音先落盘，评分挂掉时
          // n_takes 就变成了 1，曝光轮会永久消失，而她既没拿到基线也没拿到反馈。
          first_exposure: !parseInt(st.exposed || 0, 10),
          calibrating: await R.calibrating_now(store, CFG, { day }),
          takes: takes.map((t) => ({
            take_id: t.take_id,
            ts: t.ts,
            total: t.total ?? null,
            verdict: t.verdict || '',
            version: t.version || 'base',
            passed: t.passed || 0,
            audio_url: mediaUrl(req, `take/${t.take_id}`),
            mode: t.mode || 'recall',
            variant_type: t.variant_type || 'original',
          })),
        });
      }

      if (action === 'take' && req.method === 'POST') {
        const ct = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (!AUDIO_TYPES.includes(ct)) return json(res, 415, { error: `bad content-type: ${ct}` });
        let meta = {};
        try {
          const raw = req.headers['x-recite-meta'];
          if (raw) meta = JSON.parse(Buffer.from(String(raw), 'base64').toString('utf8'));
        } catch {
          return json(res, 400, { error: 'bad X-Recite-Meta' });
        }
        const blob = await readBody(req);
        if (!blob.length) return json(res, 400, { error: 'empty audio' });

        // 先落盘，再做别的。ASR 或 Anthropic 任一失败，她那 90 秒不会丢。
        const ext = ct.includes('mp4') || ct.includes('m4a') ? '.m4a' : '.webm';
        const ts = R.now_iso().replace(/:/g, '').replace(/-/g, '');
        const name = `takes/${id.replace(/:/g, '_')}-${ts}${ext}`;
        await media.put(name, blob, ct);

        const st = { ...R.default_state(id), ...((await store.getState(id)) || {}) };
        // 客户端说这是曝光轮 **且** 库里还没记过曝光，才算数。
        const first_exposure = meta.first_exposure && !parseInt(st.exposed || 0, 10) ? 1 : 0;
        const take_id = newTakeId();
        const ver = versionOf(it, meta.version);
        await store.putTake({
          take_id,
          item_id: id,
          ts: R.now_iso(),
          version: ver.name,
          mode: meta.mode || 'recall',
          first_exposure,
          variant: meta.variant_q || '',
          variant_type: meta.variant_type || 'original',
          variant_sec: parseInt(meta.variant_sec || ver.target_sec || 60, 10),
          variant_hint: meta.variant_hint || '',
          why_line: String(meta.why_line || '').trim(),
          audio: name,
          content_type: ct,
          dur_sec: Number(meta.duration_sec || 0),
          self_est: meta.self_est === undefined || meta.self_est === null
            ? null : Number(meta.self_est),
          transcript: null, metrics: null, verbatim_ratio: null, r_prev: null,
          scores: null, red_flags: null, missed_cues: null, fact_check: null,
          fix_next: null, one_line: null, verdict: null, judge_raw: null,
          passed: 0, coverage: null, total: null, hard_ok: 0, gate_note: '',
        });
        return json(res, 200, {
          take_id,
          saved: true,
          scored: false,
          audio_url: mediaUrl(req, `take/${take_id}`),
          scores: {}, transcript: '', verdict: '', total: null, gate_note: '',
        });
      }

      if (action === 'mark' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const act = String(body.action || '');
        if (act === 'needs_rewrite') {
          await store.setState(id, { needs_rewrite: 1, snooze_until: R.plus(3) });
          await store.appendRough(id, '她按了「这稿要改」');
        } else if (act === 'archive') {
          await store.setState(id, { archived: 1 });
        } else if (act === 'unarchive') {
          await store.setState(id, { archived: 0 });
        } else if (act === 'scope_thin') {
          // DEVIATION: jobscan 写 recite_items.scope；bundle 是只读内容，所以标记落在
          // state.scope_override 上（M4 §3.2 里已经留了这个字段）。
          await store.setState(id, { scope_override: 'thin' });
        } else if (act === 'practice') {
          // 三遍练习追踪：body = {step: shadow|blind|timed, on: true|false}。
          // on=false 允许手滑取消。时间戳由服务端打（离线补传的勾会晚一点，可接受）。
          const step = String(body.step || '');
          if (!R.PRACTICE_STEPS.includes(step)) {
            return json(res, 400, { error: 'unknown practice step' });
          }
          await store.setState(id, {
            [`practice_${step}_at`]: body.on === false ? null : R.now_iso(),
          });
        } else if (act === 'box') {
          await store.setState(id, {
            box: Math.max(1, Math.min(5, parseInt(body.box || 1, 10) || 1)),
            streak: 0,
          });
        } else if (act === 'snooze') {
          await store.setState(id, { due_on: R.plus(parseInt(body.days || 1, 10) || 1) });
        } else {
          return json(res, 400, { error: 'unknown action' });
        }
        return json(res, 200, { ok: true });
      }

      if (action === 'exposure' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const stage = Math.max(0, Math.min(4, parseInt(body.stage || 0, 10) || 0));
        await store.setState(id, { exposure_stage: stage, exposure_at: R.now_iso() });
        return json(res, 200, { ok: true, stage });
      }
      return json(res, 405, { error: 'method not allowed' });
    }

    // ── POST /recite/takes/:id/rescore ──────────────────────────
    m = /^\/recite\/takes\/([^/]+)\/rescore$/.exec(p);
    if (m && req.method === 'POST') {
      const take_id = m[1];
      const row = await store.getTake(take_id);
      if (!row) return json(res, 404, { error: 'no such take' });
      const body = await readJsonBody(req);
      const patch = {};
      // why 现在在录完之后才问，所以要允许回填到已经落盘的 take 行上。
      if (String(body.why_line || '').trim()) patch.why_line = String(body.why_line).trim();
      if (['recall', 'read'].includes(body.mode)) patch.mode = body.mode;
      if (Object.keys(patch).length) await store.updateTake(take_id, patch);
      try {
        return json(res, 200, await scoreTake(deps, take_id));
      } catch (e) {
        // 评分链任何一环挂掉都不该吃掉录音。
        console.error('score failed', e);
        return json(res, 200, {
          take_id, saved: true,
          judge_error: `${(e && e.constructor && e.constructor.name) || 'Error'}: ${(e && e.message) || e}`,
          scores: {}, transcript: '', verdict: '', total: null,
          gate_note: '评分没跑出来，录音已存',
        });
      }
    }

    return json(res, 404, { error: 'not found' });
  };

  return http.createServer((req, res) => {
    handler(req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) json(res, e.status || 500, { error: String((e && e.message) || e) });
      else res.end();
    });
  });
}

/** 稿子版本：base（原稿）/ short（1–2 分钟）/ long（3–5 分钟）。缺对应稿就退回 base。 */
export function versionOf(it, requested) {
  const want = String(requested || 'base');
  if (want === 'long' && it.script_long) {
    return { name: 'long', script: it.script_long, target_sec: it.target_sec_long || it.target_sec };
  }
  if (want === 'short' && it.script_short) {
    return { name: 'short', script: it.script_short, target_sec: it.target_sec_short || it.target_sec };
  }
  return { name: 'base', script: it.script || '', target_sec: it.target_sec };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (!process.env.ATOM_SYNC_TOKEN) console.warn('WARNING: ATOM_SYNC_TOKEN unset — every request will 401');
  const server = await makeServer();
  server.listen(PORT, () => console.log(`Atoms recite listening on ${PORT} · ${ITEMS.length} items`));
}
