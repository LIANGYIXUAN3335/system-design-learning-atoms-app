import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FileStore, newTakeId, makeStore } from '../lib/store.mjs';
import { FileMedia } from '../lib/media.mjs';

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('newTakeId 的字典序 == 时间序（listTakes 的排序全靠这条）', () => {
  const a = newTakeId(1756900000000);
  const b = newTakeId(1756900000001);
  assert.match(a, /^t_\d{13}_[0-9a-z]{4}$/);
  assert.ok(a < b);
});

test('FileStore：state 往返 + 部分 patch 合并', async () => {
  const store = new FileStore(tmp('recite-store-'));
  assert.equal(await store.getState('x'), null);
  await store.setState('x', { box: 2, due_on: '2026-09-05' });
  await store.setState('x', { streak: 1 });
  const st = await store.getState('x');
  assert.equal(st.box, 2);
  assert.equal(st.due_on, '2026-09-05');
  assert.equal(st.streak, 1);
  assert.ok(st.updated_at);
  assert.deepEqual((await store.listStates()).map((s) => s.item_id), ['x']);
});

test('FileStore：takes 往返、按 take_id 降序、where 过滤、count', async () => {
  const store = new FileStore(tmp('recite-store-'));
  for (const [i, item] of [['1', 'a'], ['2', 'a'], ['3', 'b']].entries()) {
    await store.putTake({
      take_id: `t_000000000000${item[0]}_aaaa`,
      item_id: item[1],
      ts: `2026-09-0${i + 1}T10:00:00-07:00`,
      first_exposure: i === 0 ? 1 : 0,
      variant_type: i === 2 ? 'paraphrase' : 'original',
      passed: 0,
    });
  }
  const all = await store.listTakes();
  assert.deepEqual(all.map((t) => t.take_id.slice(-6, -5)), ['3', '2', '1'], '默认降序');
  assert.equal((await store.listTakes('a')).length, 2);
  assert.equal((await store.listTakes(null, 0, { where: { first_exposure: 0 } })).length, 2);
  assert.equal((await store.listTakes(null, 1, { where: { first_exposure: 0 }, order: 'asc' }))[0].take_id,
    't_0000000000002_aaaa');
  assert.equal(await store.countTakes({ variant_type: 'paraphrase' }), 1);
  assert.equal(await store.countTakes({ first_exposure: 0 }), 2);

  await store.updateTake('t_0000000000001_aaaa', { passed: 1, transcript: 'hello' });
  const one = await store.getTake('t_0000000000001_aaaa');
  assert.equal(one.passed, 1);
  assert.equal(one.transcript, 'hello');
  assert.equal(one.item_id, 'a', 'patch 不该抹掉别的字段');
  assert.equal(await store.getTake('nope'), null);
  assert.equal(await store.updateTake('nope', { passed: 1 }), null);
});

test('FileStore：rough 队列追加', async () => {
  const store = new FileStore(tmp('recite-store-'));
  await store.appendRough('x', '连续 fail，稿要改');
  await store.appendRough('x', '她按了「这稿要改」');
  const rough = await store.listRough();
  assert.equal(rough.length, 1);
  assert.equal(rough[0].entries.length, 2);
  assert.ok(rough[0].entries[0].at);
});

test('FileStore：重开一个实例能读到落盘的东西', async () => {
  const dir = tmp('recite-store-');
  await new FileStore(dir).setState('x', { box: 4 });
  assert.equal((await new FileStore(dir).getState('x')).box, 4);
});

test('makeStore：RECITE_STORE_DIR 存在时默认走 file', async () => {
  const dir = tmp('recite-store-');
  assert.ok((await makeStore({ RECITE_STORE_DIR: dir })) instanceof FileStore);
  await assert.rejects(() => makeStore({ RECITE_STORE: 'file' }), /RECITE_STORE_DIR/);
});

test('FileMedia：put / stat / stream / range，并挡住 ../ 穿越', async () => {
  const dir = tmp('recite-media-');
  const media = new FileMedia(dir);
  await media.put('takes/x.webm', Buffer.from('0123456789'), 'audio/webm');
  assert.equal((await media.stat('takes/x.webm')).size, 10);
  assert.equal((await media.stat('takes/x.webm')).contentType, 'audio/webm');
  assert.equal(await media.exists('takes/nope.webm'), false);
  assert.equal(media.gcsUri('takes/x.webm'), null);

  const chunks = [];
  for await (const c of media.stream('takes/x.webm', { start: 2, end: 5 })) chunks.push(c);
  assert.equal(Buffer.concat(chunks).toString(), '2345');

  assert.throws(() => media.stream('../../etc/passwd'), /bad media name/);
});
