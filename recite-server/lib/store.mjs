// 状态层。两种实现，同一个接口：
//   FirestoreStore —— 云上（atoms/recite/{state,takes,rough}，和 atoms-sync 同库）
//   FileStore      —— 本地跑和测试（RECITE_STORE_DIR 下三个 JSON）
//
// 接口：
//   getState(id) setState(id, patch) listStates()
//   listTakes(itemId?, limit?, {where, order}?)  getTake(id)  putTake(doc)  updateTake(id, patch)
//   countTakes(where)  appendRough(id, why)  listRough()
//
// listTakes 默认按 take_id 降序（take_id = `t_<epoch ms>_<4 位随机>`，13 位定宽 epoch 让
// 字典序 == 时间序，直到 2286 年）—— 它替代了 sqlite 的 `ORDER BY id DESC`。

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { now_iso, today } from './recite.mjs';

// 全局扫描上限。Firestore 上「所有 take」的查询按 doc id 排序分页，不需要复合索引；
// 一个人的练习库不会接近这个数，但没有上限的全表扫描是不能上线的东西。
const GLOBAL_SCAN_CAP = 2000;

export function newTakeId(now = Date.now()) {
  const rnd = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, '0');
  return `t_${String(now).padStart(13, '0')}_${rnd}`;
}

function matches(doc, where) {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    const a = doc[k];
    // sqlite 里 passed/first_exposure 是 0/1 整数；这里统一按数值比。
    if (typeof v === 'number' ? Number(a || 0) !== v : a !== v) return false;
  }
  return true;
}

function sortTakes(rows, order = 'desc') {
  const s = [...rows].sort((a, b) => (a.take_id < b.take_id ? -1 : a.take_id > b.take_id ? 1 : 0));
  return order === 'asc' ? s : s.reverse();
}

// ---------------------------------------------------------------- FileStore

export class FileStore {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.paths = {
      state: path.join(dir, 'state.json'),
      takes: path.join(dir, 'takes.json'),
      rough: path.join(dir, 'rough.json'),
    };
  }

  async _read(kind, fallback) {
    try {
      return JSON.parse(await fsp.readFile(this.paths[kind], 'utf8'));
    } catch {
      return fallback;
    }
  }

  async _write(kind, value) {
    const tmp = `${this.paths[kind]}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(value, null, 1));
    await fsp.rename(tmp, this.paths[kind]);
  }

  async getState(id) {
    const all = await this._read('state', {});
    return all[id] ? { item_id: id, ...all[id] } : null;
  }

  async setState(id, patch) {
    const all = await this._read('state', {});
    all[id] = { ...(all[id] || {}), ...patch, updated_at: now_iso() };
    await this._write('state', all);
    return { item_id: id, ...all[id] };
  }

  async listStates() {
    const all = await this._read('state', {});
    return Object.entries(all).map(([id, v]) => ({ item_id: id, ...v }));
  }

  async listTakes(itemId = null, limit = 0, opts = {}) {
    const all = await this._read('takes', {});
    let rows = Object.values(all);
    if (itemId) rows = rows.filter((r) => r.item_id === itemId);
    rows = rows.filter((r) => matches(r, opts.where));
    rows = sortTakes(rows, opts.order || 'desc');
    return limit > 0 ? rows.slice(0, limit) : rows;
  }

  async getTake(id) {
    const all = await this._read('takes', {});
    return all[id] || null;
  }

  async putTake(doc) {
    const all = await this._read('takes', {});
    all[doc.take_id] = doc;
    await this._write('takes', all);
    return doc;
  }

  async updateTake(id, patch) {
    const all = await this._read('takes', {});
    if (!all[id]) return null;
    all[id] = { ...all[id], ...patch };
    await this._write('takes', all);
    return all[id];
  }

  async countTakes(where) {
    const all = await this._read('takes', {});
    return Object.values(all).filter((r) => matches(r, where)).length;
  }

  async appendRough(id, why) {
    const all = await this._read('rough', {});
    all[id] = [...(all[id] || []), { why, at: today() }];
    await this._write('rough', all);
  }

  async listRough() {
    const all = await this._read('rough', {});
    return Object.entries(all).map(([item_id, entries]) => ({ item_id, entries }));
  }
}

// ---------------------------------------------------------------- FirestoreStore

export class FirestoreStore {
  constructor(db, docId) {
    this.db = db;
    this.docId = docId;
    this.root = db.collection('atoms').doc('recite');
    this.state = this.root.collection('state');
    this.takes = this.root.collection('takes');
    this.rough = this.root.collection('rough');
  }

  async getState(id) {
    const snap = await this.state.doc(id).get();
    return snap.exists ? { item_id: id, ...snap.data() } : null;
  }

  async setState(id, patch) {
    await this.state.doc(id).set({ ...patch, updated_at: now_iso() }, { merge: true });
    return this.getState(id);
  }

  async listStates() {
    const snap = await this.state.get();
    return snap.docs.map((d) => ({ item_id: d.id, ...d.data() }));
  }

  async listTakes(itemId = null, limit = 0, opts = {}) {
    let rows;
    if (itemId) {
      // 单条条目的 take 数量以个位数计 —— 只用一个等值过滤（无需复合索引），排序在内存里做。
      const snap = await this.takes.where('item_id', '==', itemId).get();
      rows = snap.docs.map((d) => d.data());
    } else {
      // 全库：按 doc id 排序（doc id == take_id，字典序 == 时间序）。**只能升序**：Firestore 对
      // __name__ 的降序排序要求一个复合索引（云上实测 FAILED_PRECONDITION），升序是内建的。
      // 所以这里永远升序拉 GLOBAL_SCAN_CAP 条，方向在内存里翻。2000 条 = 三年的每日 2 次，够用。
      const snap = await this.takes.orderBy(this.docId, 'asc').limit(GLOBAL_SCAN_CAP).get();
      rows = snap.docs.map((d) => d.data());
    }
    let out = rows.filter((r) => matches(r, opts.where));
    out = sortTakes(out, opts.order || 'desc');
    return limit > 0 ? out.slice(0, limit) : out;
  }

  async getTake(id) {
    const snap = await this.takes.doc(id).get();
    return snap.exists ? snap.data() : null;
  }

  async putTake(doc) {
    await this.takes.doc(doc.take_id).set(doc);
    return doc;
  }

  async updateTake(id, patch) {
    // 用 update 而不是 set(merge)：merge 会对 metrics / judge_raw 这类嵌套 map 做深合并，
    // 于是上一次评分的残留字段（比如旧的 asr_error）会留在里面。update 整字段替换。
    await this.takes.doc(id).update(patch);
    return this.getTake(id);
  }

  async countTakes(where) {
    let q = this.takes;
    for (const [k, v] of Object.entries(where || {})) q = q.where(k, '==', v);
    const snap = await q.count().get();
    return snap.data().count;
  }

  async appendRough(id, why) {
    const ref = this.rough.doc(id);
    const snap = await ref.get();
    const entries = snap.exists ? snap.data().entries || [] : [];
    entries.push({ why, at: today() });
    await ref.set({ entries }, { merge: true });
  }

  async listRough() {
    const snap = await this.rough.get();
    return snap.docs.map((d) => ({ item_id: d.id, entries: d.data().entries || [] }));
  }
}

// ---------------------------------------------------------------- 选择

export async function makeStore(env = process.env) {
  const kind = env.RECITE_STORE || (env.RECITE_STORE_DIR ? 'file' : 'firestore');
  if (kind === 'file') {
    if (!env.RECITE_STORE_DIR) throw new Error('RECITE_STORE=file needs RECITE_STORE_DIR');
    return new FileStore(env.RECITE_STORE_DIR);
  }
  const { Firestore, FieldPath } = await import('@google-cloud/firestore');
  // ignoreUndefinedProperties：一个 undefined 字段会让整次写入抛，而这条路径上挂掉 == 丢录音。
  return new FirestoreStore(new Firestore({ ignoreUndefinedProperties: true }), FieldPath.documentId());
}
