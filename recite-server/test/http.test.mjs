// 端到端冒烟：库 → 上传 → 评分 → 箱位 → 回听（Range）。
// STT 和判官都走桩（RECITE_STUB_STT / RECITE_STUB_JUDGE）—— 桩路径必须显式开，生产走不到。

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = 't';
const BUNDLE = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'data', 'recite.bundle.json'), 'utf8'));
const ITEM = BUNDLE.find((x) => x.script && !x.deferred && x.quality === 'ok') || BUNDLE[0];

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recite-http-'));
  const env = {
    ...process.env,
    ATOM_SYNC_TOKEN: TOKEN,
    RECITE_STORE: 'file',
    RECITE_STORE_DIR: path.join(dir, 'store'),
    RECITE_MEDIA_DIR: path.join(dir, 'media'),
    RECITE_STUB_STT: '1',
    RECITE_STUB_JUDGE: '1',
    PUBLIC_BASE_URL: '',
  };
  const { makeServer } = await import('../server.mjs');
  const server = await makeServer(env);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    dir,
    close: () => new Promise((r) => server.close(r)),
    get: (p, init = {}) => fetch(base + p, {
      ...init,
      headers: { authorization: `Bearer ${TOKEN}`, ...(init.headers || {}) },
    }),
  };
}

test('冒烟：overview → 上传 → 回听 → 评分 → mark', async (t) => {
  const app = await boot();
  t.after(() => app.close());

  // ── healthz 不要 token ──────────────────────────────────────
  assert.equal((await fetch(`${app.base}/healthz`)).status, 200);
  assert.equal((await fetch(`${app.base}/recite/overview`)).status, 401);
  assert.equal((await fetch(`${app.base}/recite/overview`, {
    headers: { authorization: 'Bearer wrong' },
  })).status, 401);

  // ── overview：全 bundle 条状态 + ≤6 条队列 ────────────────────────
  const ov = await (await app.get('/recite/overview')).json();
  assert.equal(Object.keys(ov.state).length, BUNDLE.length);
  assert.ok(ov.queue_ids.length > 0 && ov.queue_ids.length <= 6);
  assert.equal(ov.calibrating, true);
  assert.deepEqual(ov.n_takes, {});
  assert.match(ov.today, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(ov.state[ITEM.id].box, 1);
  assert.equal(ov.hist.buckets.length, 0);
  assert.ok(Array.isArray(ov.dupes));

  // ── item 详情 ───────────────────────────────────────────────
  const it = await (await app.get(`/recite/items/${ITEM.id}`)).json();
  assert.equal(it.n_recorded, 0);
  assert.equal(it.first_exposure, true);
  assert.equal(it.variant.type, 'original');
  assert.deepEqual(it.takes, []);
  assert.equal((await app.get('/recite/items/no-such-item')).status, 404);
  assert.equal((await app.get('/recite/items/NOT VALID')).status, 400);

  // ── 上传：原始字节 + base64 meta ────────────────────────────
  const meta = Buffer.from(JSON.stringify({
    mode: 'recall', variant_type: 'original', variant_sec: ITEM.target_sec,
    variant_q: ITEM.question, first_exposure: false, self_est: 3.5, duration_sec: 42,
    why_line: '因为那是当时唯一能保住时延的做法',
  })).toString('base64');
  const bytes = Buffer.from('FAKEAUDIOBYTES-0123456789');
  const up = await (await app.get(`/recite/items/${ITEM.id}/take`, {
    method: 'POST',
    headers: { 'content-type': 'audio/webm', 'x-recite-meta': meta },
    body: bytes,
  })).json();
  assert.equal(up.saved, true);
  assert.equal(up.scored, false, '上传只落盘，评分是另一个按钮');
  assert.match(up.take_id, /^t_\d{13}_/);
  assert.ok(up.audio_url.startsWith(`${app.base}/media/take/${up.take_id}?token=`),
    'audio_url 必须是绝对地址且自带 token');

  assert.equal((await app.get(`/recite/items/${ITEM.id}/take`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  })).status, 415);

  // ── 媒体：401 / 404 / 200 / 206 ─────────────────────────────
  assert.equal((await fetch(`${app.base}/media/take/${up.take_id}`)).status, 401);
  assert.equal((await fetch(`${app.base}/media/take/${up.take_id}?token=nope`)).status, 401);
  assert.equal((await fetch(`${app.base}/media/take/t_0000000000000_zzzz?token=${TOKEN}`)).status, 404);
  assert.equal((await fetch(`${app.base}/media/orig/${ITEM.id}.mp3?token=${TOKEN}`)).status, 404);
  assert.equal((await fetch(`${app.base}/media/orig/..%2f..%2fetc.mp3?token=${TOKEN}`)).status, 400);
  assert.equal((await fetch(`${app.base}/media/bogus/x?token=${TOKEN}`)).status, 400);

  const full = await fetch(up.audio_url);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.equal(full.headers.get('content-type'), 'audio/webm');
  assert.equal(await full.text(), bytes.toString());

  const ranged = await fetch(up.audio_url, { headers: { range: 'bytes=4-8' } });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('content-range'), `bytes 4-8/${bytes.length}`);
  assert.equal(await ranged.text(), 'AUDIO');

  const tail = await fetch(up.audio_url, { headers: { range: 'bytes=20-' } });
  assert.equal(tail.status, 206);
  assert.equal(await tail.text(), '56789');

  // ── 评分：桩 STT + 桩判官 ───────────────────────────────────
  const sc = await (await app.get(`/recite/takes/${up.take_id}/rescore`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  })).json();
  assert.equal(sc.take_id, up.take_id);
  assert.equal(sc.judge_error, '');
  assert.equal(sc.metrics.asr_engine, 'stub');
  assert.equal(sc.metrics.duration, 42, 'duration 由客户端上报，末词只做校正');
  assert.ok(sc.metrics.pauses_over_2s >= 1);
  assert.equal(sc.coverage, 5);
  assert.equal(sc.verdict, 'Hire');
  assert.equal(sc.hard_ok, 1);
  assert.equal(sc.passed, 1);
  assert.equal(sc.state.n_takes, 1);
  assert.equal(sc.state.streak, 1);
  assert.equal(sc.calibrating, true);
  assert.equal(sc.r_prev, null, '第一条 take 没有对照物');

  assert.equal((await app.get('/recite/takes/t_0000000000000_zzzz/rescore', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  })).status, 404);

  // ── 评分后的 item / overview ────────────────────────────────
  const it2 = await (await app.get(`/recite/items/${ITEM.id}`)).json();
  assert.equal(it2.n_recorded, 1);
  assert.equal(it2.takes.length, 1);
  assert.equal(it2.takes[0].passed, 1);
  assert.equal(it2.takes[0].total, sc.total);
  assert.ok(it2.takes[0].audio_url.includes(`?token=${TOKEN}`));
  assert.equal(it2.state.n_takes, 1);
  assert.equal(it2.variant.type, ITEM.variants.length ? ITEM.variants[0].type : 'original',
    '第 2 次起按 n_takes 轮换到第一个变体');

  const ov2 = await (await app.get('/recite/overview')).json();
  assert.equal(ov2.n_takes[ITEM.id], 1);
  assert.equal(ov2.hist.buckets.length, 1);
  assert.equal(ov2.hist.buckets[0].n, 1);
  assert.equal(ov2.hist.buckets[0].pass_rate, 100);

  // ── mark / exposure ────────────────────────────────────────
  const mark = (body) => app.get(`/recite/items/${ITEM.id}/mark`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal((await (await mark({ action: 'needs_rewrite' })).json()).ok, true);
  assert.equal((await (await mark({ action: 'box', box: 9 })).json()).ok, true);
  assert.equal((await (await app.get(`/recite/items/${ITEM.id}`)).json()).state.box, 5, '箱位夹在 1–5');
  assert.equal((await (await mark({ action: 'archive' })).json()).ok, true);
  assert.equal((await mark({ action: 'nope' })).status, 400);

  // ── practice：三遍练习勾选框（跟读/闭眼/掐表）─────────────────
  assert.equal((await (await mark({ action: 'practice', step: 'shadow' })).json()).ok, true);
  assert.equal((await (await mark({ action: 'practice', step: 'timed' })).json()).ok, true);
  assert.equal((await mark({ action: 'practice', step: 'nope' })).status, 400);
  let st = (await (await app.get(`/recite/items/${ITEM.id}`)).json()).state;
  assert.ok(st.practice_shadow_at, '勾了要有时间戳');
  assert.equal(st.practice_blind_at, null, '没勾的保持 null');
  assert.ok(st.practice_timed_at);
  // 手滑取消：on=false 清回 null
  assert.equal((await (await mark({ action: 'practice', step: 'timed', on: false })).json()).ok, true);
  st = (await (await app.get(`/recite/items/${ITEM.id}`)).json()).state;
  assert.equal(st.practice_timed_at, null);
  // overview 的 state 合并也带这些字段（库页统计靠它）
  const ovp = await (await app.get('/recite/overview')).json();
  assert.ok(ovp.state[ITEM.id].practice_shadow_at);

  const exp = await (await app.get(`/recite/items/${ITEM.id}/exposure`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stage: 9 }),
  })).json();
  assert.deepEqual(exp, { ok: true, stage: 4 });

  const ov3 = await (await app.get('/recite/overview')).json();
  assert.equal(ov3.state[ITEM.id].archived, 1);
  assert.ok(!ov3.queue_ids.includes(ITEM.id), '归档的条目不再进队列');

  // rough 队列（needs_rewrite 按钮）落了盘
  const rough = JSON.parse(fs.readFileSync(path.join(app.dir, 'store', 'rough.json'), 'utf8'));
  assert.equal(rough[ITEM.id][0].why, '她按了「这稿要改」');
});

test('冒烟：评分链挂掉时录音仍然在，返回 judge_error', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recite-http-'));
  const { makeServer } = await import('../server.mjs');
  const server = await makeServer({
    ...process.env,
    ATOM_SYNC_TOKEN: TOKEN,
    RECITE_STORE: 'file',
    RECITE_STORE_DIR: path.join(dir, 'store'),
    RECITE_MEDIA_DIR: path.join(dir, 'media'),
    RECITE_STUB_STT: '1',
    // 判官不打桩、也没有 key → review 返回空卡（error 而不是异常）
    ANTHROPIC_API_KEY: '',
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const h = { authorization: `Bearer ${TOKEN}` };

  const up = await (await fetch(`${base}/recite/items/${ITEM.id}/take`, {
    method: 'POST',
    headers: {
      ...h,
      'content-type': 'audio/mp4',
      'x-recite-meta': Buffer.from(JSON.stringify({ duration_sec: 42, why_line: 'w' })).toString('base64'),
    },
    body: Buffer.from('abc'),
  })).json();
  assert.equal(up.saved, true);

  const sc = await (await fetch(`${base}/recite/takes/${up.take_id}/rescore`, {
    method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: '{}',
  })).json();
  assert.equal(sc.judge_error, 'ai disabled or no api key');
  assert.equal(sc.passed, 0, '判官挂了 ≠ 过关');
  assert.match(sc.gate_note, /评分没跑出来，录音已存/);
  // 录音仍然在盘上，m4a 后缀跟着 content-type 走
  const files = fs.readdirSync(path.join(dir, 'media', 'takes'));
  assert.equal(files.length, 1);
  assert.ok(files[0].endsWith('.m4a'));
  assert.equal((await fetch(`${base}/media/take/${up.take_id}?token=${TOKEN}`)).status, 200);
});
