import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as R from '../lib/recite.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'data', 'recite.bundle.json'), 'utf8'));
const CFG = R.cfg_recite({});

// 内存 store：只实现 recite.mjs 用到的那几个方法。
function memStore(state = {}, takes = []) {
  return {
    rough: [],
    async getState(id) { return state[id] || null; },
    async setState(id, patch) { state[id] = { ...(state[id] || {}), ...patch }; return state[id]; },
    async listStates() { return Object.entries(state).map(([item_id, v]) => ({ item_id, ...v })); },
    async listTakes(itemId = null, limit = 0, opts = {}) {
      let rows = takes.filter((t) => !itemId || t.item_id === itemId);
      for (const [k, v] of Object.entries(opts.where || {})) rows = rows.filter((r) => Number(r[k] || 0) === v);
      rows = [...rows].sort((a, b) => (a.take_id < b.take_id ? -1 : 1));
      if ((opts.order || 'desc') === 'desc') rows.reverse();
      return limit > 0 ? rows.slice(0, limit) : rows;
    },
    async countTakes(where) {
      return takes.filter((t) => Object.entries(where || {})
        .every(([k, v]) => Number(t[k] || 0) === v)).length;
    },
    async appendRough(id, why) { this.rough.push([id, why]); },
    async listRough() { return this.rough; },
    _state: state,
  };
}

const review = (over = {}) => ({
  scores: { structure: 4, concision: 4, fluency: 4, why_depth: 4 },
  missed_cues: [], evidence: {}, issues: [], fix_next: '', one_line: '', error: '',
  ...over,
});

const baseJudge = (over = {}) => ({
  cfg_r: CFG,
  item: { target_sec: 60 },
  points: [],
  scored: [{ t: 'content', text: 'a', probe: '' }, { t: 'content', text: 'b', probe: '' }],
  transcript: 'hello world this is a take',
  metrics: { duration: 60 },
  review: review(),
  why_line: '因为这是当时唯一能保住时延的做法',
  variant_type: 'original', variant_sec: 60, mode: 'recall', first_exposure: false,
  box: 1, calibrating: false, r: 0.2, n_paraphrase_takes: 0, number_flags: [],
  ...over,
});

// ---------------------------------------------------------------- 移植保真

test('scored_cues 复算能重现 bundle 里全部 336 条的 scored_idx / extra_idx', () => {
  assert.equal(BUNDLE.length, 336);
  const mismatch = [];
  for (const it of BUNDLE) {
    const pts = it.points || [];
    const [sc, ex] = R.scored_cues(pts);
    const idxOf = (k) => pts.findIndex((p) => p.t === k.t && p.text === k.text && p.probe === k.probe);
    if (JSON.stringify(sc.map(idxOf)) !== JSON.stringify(it.scored_idx)
        || JSON.stringify(ex.map(idxOf)) !== JSON.stringify(it.extra_idx)) {
      mismatch.push(it.id);
    }
  }
  assert.deepEqual(mismatch, []);
});

test('scored_cues：canon 优先 → 数字/因果 → 其余，且 ≤4 条进分母', () => {
  const pts = [
    { t: 'content', text: '普通一条', probe: '' },
    { t: 'content', text: '降了 30%', probe: '' },
    { t: 'canon', text: 'CANON 三年', probe: '' },
    { t: 'content', text: '因为延迟', probe: '' },
    { t: 'content', text: '另一条普通', probe: '' },
    { t: 'form', text: '每句话短一点', probe: '' },
  ];
  const [scored, extra] = R.scored_cues(pts);
  assert.deepEqual(scored.map((k) => k.text), ['CANON 三年', '降了 30%', '因为延迟', '普通一条']);
  assert.deepEqual(extra.map((k) => k.text), ['另一条普通']);
  assert.ok(!scored.some((k) => k.t === 'form'), 'form 型永远不进 coverage 分母（约束 2）');
});

test('classify_key_point：canon 先于 form，注记被丢弃', () => {
  assert.equal(R.classify_key_point('口径：不要说 30–40%').t, 'canon');
  assert.equal(R.classify_key_point('每句话不要超过 16 个词').t, 'form');
  assert.equal(R.classify_key_point('不许说 "we crushed the numbers here"').t, 'forbid');
  assert.equal(R.classify_key_point('不许说 "we crushed the numbers here"').probe,
    'we crushed the numbers here');
  assert.equal(R.classify_key_point('见上文 recap.md §3').t, 'drop');
  assert.equal(R.parse_key_points(['见上文 §3', '', '正常内容']).length, 1);
});

test('coverage_score 阈值', () => {
  const s = (n) => Array.from({ length: n }, (_, i) => ({ t: 'content', text: `c${i}`, probe: '' }));
  assert.equal(R.coverage_score([], []), 3, '没有分母时给中位数');
  assert.equal(R.coverage_score(s(4), []), 5);
  assert.equal(R.coverage_score(s(5), ['x']), 4);       // 4/5 = 0.8
  assert.equal(R.coverage_score(s(5), ['x', 'y']), 3);  // 3/5 = 0.6
  assert.equal(R.coverage_score(s(5), ['x', 'y', 'z']), 2); // 2/5 = 0.4
  assert.equal(R.coverage_score(s(5), ['a', 'b', 'c', 'd']), 1);
  assert.equal(R.coverage_score(s(4), ['', '']), 5, '空串不算 missed');
});

test('verbatim_ratio 把 «…» 跨度从稿里剥掉后再算 4-gram', () => {
  const said = 'three years of full stack work at tiktok and meta';
  const script = '«three years of full stack» work at tiktok and meta';
  assert.equal(R.strip_canon(script), '  work at tiktok and meta');
  assert.deepEqual(R.canon_spans(script), ['three years of full stack']);
  const withCanon = R.verbatim_ratio(said, script);
  const withoutStripping = R.verbatim_ratio(said, script.replace(/«|»/g, ''));
  assert.ok(withCanon < withoutStripping, '逐字跨度不该进 r 的分母');
  assert.equal(R.verbatim_ratio('', script), 0);
  assert.equal(R.verbatim_ratio('a b c', 'a b c'), 0, '不足 4 词 → 无 4-gram');
});

test('wpm / filler_counts / target_sec_from_words', () => {
  assert.equal(R.wpm('one two three four', { speaking_sec: 60 }), 4);
  assert.equal(R.wpm('x', { speaking_sec: 0, duration: 0 }), 0);
  assert.deepEqual(R.filler_counts('Um, I uh basically like did it'),
    { hard_filler: 2, soft_filler: 2 });
  assert.equal(R.target_sec_from_words(0), 45);
  assert.equal(R.target_sec_from_words(240), 120);
  assert.equal(R.target_sec_from_words(1), 20, '地板 20 秒');
});

test('variant_for 从第 2 次起轮换', () => {
  const it = {
    question: 'Q', target_sec: 90,
    variants: [{ type: 'constraint', q: 'Q', sec: 60, hint: 'h' }],
  };
  assert.equal(R.variant_for(it, 0).type, 'original');
  assert.equal(R.variant_for(it, 1).type, 'constraint');
  assert.equal(R.variant_for(it, 2).type, 'original');
  assert.equal(R.variant_for({ question: 'Q', target_sec: 30, variants: [] }, 3).type, 'original');
});

// ---------------------------------------------------------------- 闸门

test('gates：原版档 1.4× / 覆盖 4 / 会降箱', () => {
  const g = R.gates(CFG, 'original', 60, 60, true, 0);
  assert.deepEqual(g, { dur_gate: 84, coverage_gate: 4, r_is_flag: false, demotes_on_fail: true, sec: 60 });
});

test('gates：压缩档 1.05× / 覆盖 3 / r 不成旗 / fail 不降箱（FEY-A4 的两半必须成对）', () => {
  for (const vt of R.CONSTRAINED) {
    const g = R.gates(CFG, vt, 40, 60, false, 99);
    assert.equal(g.dur_gate, 42, `${vt}: 1.05 × variant_sec，不是 1.4×`);
    assert.equal(g.coverage_gate, 3);
    assert.equal(g.r_is_flag, false);
    assert.equal(g.demotes_on_fail, false);
    assert.equal(g.sec, 40);
  }
  assert.equal(R.gates(CFG, 'truncate', 0, 60, false, 0).sec, 42, 'variant_sec 缺失 → 0.7 × target');
});

test('gates：paraphrase 的 r 只在校准结束且样本够时才成硬旗', () => {
  assert.equal(R.gates(CFG, 'paraphrase', 60, 60, true, 99).r_is_flag, false, '校准期不成旗');
  assert.equal(R.gates(CFG, 'paraphrase', 60, 60, false, 19).r_is_flag, false, '样本不足不成旗');
  assert.equal(R.gates(CFG, 'paraphrase', 60, 60, false, 20).r_is_flag, true);
});

// ---------------------------------------------------------------- judge_take

test('judge_take：四维齐全 + 硬门全过 → pass', () => {
  const res = R.judge_take(baseJudge());
  assert.equal(res.coverage, 5);
  assert.equal(res.total, 4.2);
  assert.equal(res.verdict, 'Hire');
  assert.equal(res.hard_ok, 1);
  assert.equal(res.passed, 1);
  assert.equal(res.gate_note, '');
});

test('judge_take：判官挂了 ≠ 过关（约束：coverage 单独当均值会把一次故障记成 pass）', () => {
  const res = R.judge_take(baseJudge({ review: review({ scores: {} }) }));
  assert.equal(res.total, 5, 'total 退回 coverage');
  assert.equal(res.hard_ok, 1, '硬门本身仍然过');
  assert.equal(res.passed, 0, '但不计过关');
  assert.match(res.gate_note, /评分没跑出来，录音已存/);
});

test('judge_take：wpm / speaking_ratio 不在硬门里（约束 1）', () => {
  const slow = R.judge_take(baseJudge({ metrics: { duration: 60, speaking_sec: 5 } }));
  assert.equal(slow.passed, 1, '录音条件不参与硬门');
});

test('judge_take：超时 / 覆盖不足 / 没写 why / forbid 各自阻断硬门', () => {
  assert.equal(R.judge_take(baseJudge({ metrics: { duration: 120 } })).hard_ok, 0);
  assert.match(R.judge_take(baseJudge({ metrics: { duration: 120 } })).gate_note, /120s > 上限 84s/);

  const missed = R.judge_take(baseJudge({ review: review({ missed_cues: ['a'] }) }));
  assert.equal(missed.coverage, 2);   // 2 条分母漏 1 → frac 0.5
  assert.equal(missed.hard_ok, 0);
  assert.match(missed.gate_note, /覆盖 2 < 4/);

  const noWhy = R.judge_take(baseJudge({ why_line: '   ' }));
  assert.equal(noWhy.hard_ok, 0);
  assert.match(noWhy.gate_note, /没写 why/);

  const points = [{ t: 'forbid', text: '不许说 X', probe: 'we crushed the numbers' }];
  const fb = R.judge_take(baseJudge({
    points, transcript: 'and then we crushed the numbers on that quarter',
  }));
  assert.deepEqual(fb.forbid_hits, ['we crushed the numbers']);
  assert.equal(fb.hard_ok, 0);
  assert.equal(fb.red_flags.length, 1);
  // 校准期不把 forbid 记成硬旗
  assert.equal(R.judge_take(baseJudge({
    points, transcript: 'and then we crushed the numbers on that quarter', calibrating: true,
  })).red_flags.length, 0);
});

test('judge_take：box ≥ 3 之后 why_depth 必须 ≥ 4', () => {
  const shallow = review({ scores: { structure: 5, concision: 5, fluency: 5, why_depth: 3 } });
  assert.equal(R.judge_take(baseJudge({ box: 2, review: shallow })).passed, 1);
  assert.equal(R.judge_take(baseJudge({ box: 3, review: shallow })).passed, 0);
});

test('judge_take：undertime 不是失败，只在卡片上说一句（裁决③）', () => {
  const res = R.judge_take(baseJudge({ metrics: { duration: 30 } }));
  assert.equal(res.passed, 1);
  assert.match(res.gate_note, /30s \/ 目标 60s — 要点全中，这个长度可以/);
});

test('judge_take：banned 口径进硬门，soft 的不进', () => {
  const hard = R.judge_take(baseJudge({ number_flags: ['banned:幂等框架'] }));
  assert.equal(hard.hard_ok, 0);
  assert.equal(R.judge_take(baseJudge({ number_flags: ['soft:30%'] })).hard_ok, 1);
});

test('judge_take：first_exposure 和 read 档永不计过关', () => {
  assert.equal(R.judge_take(baseJudge({ first_exposure: true })).passed, 0);
  assert.equal(R.judge_take(baseJudge({ mode: 'read' })).passed, 0);
});

test('judge_take：变体档下 r 超阈值成 reciting 红旗', () => {
  const res = R.judge_take(baseJudge({
    variant_type: 'paraphrase', calibrating: false, n_paraphrase_takes: 20, r: 0.9,
  }));
  assert.ok(res.red_flags.includes('reciting_under_variant'));
  assert.equal(res.hard_ok, 0);
});

// ---------------------------------------------------------------- 箱位

test('scaled_day：horizon 20 时用自然阶梯', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((b) => R.scaled_day(b, 20)), [1, 2, 3, 5, 5]);
  assert.deepEqual([1, 2, 3, 4, 5].map((b) => R.scaled_day(b, 8)), [1, 2, 2, 2, 2]);
});

test('apply_outcome：压缩档 fail 不降箱（约束 3）', async () => {
  const store = memStore({ x: { box: 3, streak: 1, n_takes: 4 } });
  const st = await R.apply_outcome(store, CFG, 'x', {
    passed: false, first_exposure: false, variant_type: 'constraint', same_day: false,
    hard_red: false, demotes_on_fail: false, total: 2.4, fix_next: 'f',
  });
  assert.equal(st.box, 3, '拉伸练习失败不是"你忘了"');
  assert.equal(st.streak, 0);
  assert.equal(st.due_on, R.plus(1));
});

test('apply_outcome：原版档 fail 降一箱，第二次连 fail 直接回 box 1', async () => {
  const cfg = { ...CFG, calibrating: false };
  const store = memStore({ x: { box: 3, streak: 1, n_takes: 4, last_fail: 0 } });
  let st = await R.apply_outcome(store, cfg, 'x', {
    passed: false, first_exposure: false, variant_type: 'original', same_day: false,
    hard_red: false, demotes_on_fail: true, total: 2.4, fix_next: 'f',
  });
  assert.equal(st.box, 2);
  st = await R.apply_outcome(store, cfg, 'x', {
    passed: false, first_exposure: false, variant_type: 'original', same_day: false,
    hard_red: false, demotes_on_fail: true, total: 2.4, fix_next: 'f',
  });
  assert.equal(st.box, 1, 'last_fail 已经是 1 → 直接回底');
});

test('apply_outcome：校准期 fail 不改 box', async () => {
  const store = memStore({ x: { box: 4, streak: 1, n_takes: 9 } });
  const st = await R.apply_outcome(store, CFG, 'x', {
    passed: false, first_exposure: false, variant_type: 'original', same_day: false,
    hard_red: true, demotes_on_fail: true, total: 2.0, fix_next: 'f',
  });
  assert.equal(st.box, 4);
});

test('apply_outcome：连续两次过关且近两次有变体档才晋箱', async () => {
  const takes = [
    { take_id: 't_0000000000001_aaaa', item_id: 'x', passed: 1, variant_type: 'original', first_exposure: 0 },
    { take_id: 't_0000000000002_aaaa', item_id: 'x', passed: 1, variant_type: 'constraint', first_exposure: 0 },
  ];
  const store = memStore({ x: { box: 1, streak: 1, n_takes: 2, n_pass: 1 } }, takes);
  const st = await R.apply_outcome(store, CFG, 'x', {
    passed: true, first_exposure: false, variant_type: 'constraint', same_day: false,
    hard_red: false, demotes_on_fail: false, total: 4.2, fix_next: 'f',
  });
  assert.equal(st.box, 2);
  assert.equal(st.streak, 0);
  assert.equal(st.due_on, R.plus(R.scaled_day(2, 20)));

  // 同一天的第二次过关不进 streak（避免刷同一天）
  const store2 = memStore({ y: { box: 1, streak: 1, n_takes: 2 } }, []);
  const st2 = await R.apply_outcome(store2, CFG, 'y', {
    passed: true, first_exposure: false, variant_type: 'original', same_day: true,
    hard_red: false, demotes_on_fail: true, total: 4.2, fix_next: 'f',
  });
  assert.equal(st2.streak, 1);
  assert.equal(st2.box, 1);
});

test('apply_outcome：全是原版档的连过不晋箱', async () => {
  const takes = [
    { take_id: 't_0000000000001_aaaa', item_id: 'x', passed: 1, variant_type: 'original', first_exposure: 0 },
    { take_id: 't_0000000000002_aaaa', item_id: 'x', passed: 1, variant_type: 'original', first_exposure: 0 },
  ];
  const store = memStore({ x: { box: 1, streak: 1, n_takes: 2 } }, takes);
  const st = await R.apply_outcome(store, CFG, 'x', {
    passed: true, first_exposure: false, variant_type: 'original', same_day: false,
    hard_red: false, demotes_on_fail: true, total: 4.2, fix_next: 'f',
  });
  assert.equal(st.box, 1);
  assert.equal(st.streak, 2);
});

test('apply_outcome：first_exposure 只写基线，不 pass 不 reset 不进 streak', async () => {
  const store = memStore({ x: { box: 3, streak: 1, n_takes: 0, last_fail: 1 } });
  const st = await R.apply_outcome(store, CFG, 'x', {
    passed: false, first_exposure: true, variant_type: 'original', same_day: false,
    hard_red: false, demotes_on_fail: true, total: 3.0, fix_next: 'f',
  });
  assert.equal(st.box, 3);
  assert.equal(st.streak, 1);
  assert.equal(st.due_on, R.plus(1));
  assert.equal(st.n_takes, 1);
});

test('apply_outcome：连续 3 次 fail 触发「稿要改」+ snooze', async () => {
  const takes = [1, 2, 3].map((i) => ({
    take_id: `t_000000000000${i}_aaaa`, item_id: 'x', passed: 0, first_exposure: 0,
  }));
  const store = memStore({ x: { box: 1, n_takes: 3 } }, takes);
  const st = await R.apply_outcome(store, CFG, 'x', {
    passed: false, first_exposure: false, variant_type: 'original', same_day: false,
    hard_red: false, demotes_on_fail: true, total: 2.0, fix_next: 'f',
  });
  assert.equal(st.needs_rewrite, 1);
  assert.equal(st.due_on, R.plus(3));
  assert.deepEqual(store.rough, [['x', '连续 fail，稿要改']]);
});

// ---------------------------------------------------------------- 队列

function fakeItems() {
  const out = [];
  // created_at 全库递增（a1..a4, b1..b4, c1..c4）—— 队列按 COALESCE(due_on, created_at) 排。
  let n = 0;
  for (const iv of ['A', 'B', 'C']) {
    for (let i = 1; i <= 4; i++) {
      n += 1;
      out.push({
        id: `${iv.toLowerCase()}${i}`, interview: iv, created_at: `2026-08-${String(n).padStart(2, '0')}`,
        scope: 'ok', quality: 'ok', deferred: false, target_sec: 60,
      });
    }
  }
  return out;
}

test('today_queue：new_cap 2 + per_interview_cap 2 + daily_cap 6', () => {
  const q = R.today_queue(fakeItems(), {}, {}, { day: '2026-09-03' });
  assert.deepEqual(q.map((r) => r.item_id), ['a1', 'a2', 'b1', 'b2', 'c1', 'c2']);
  assert.equal(q.length, 6);
});

test('today_queue：deferred / archived / thin / quality=rough / snooze 全部排除', () => {
  const items = fakeItems();
  items[0].deferred = true;
  items[1].quality = 'rough';
  items[2].scope = 'thin';
  const states = { a4: { archived: 1 }, b1: { snooze_until: '2026-09-10' } };
  const q = R.today_queue(items, states, {}, { day: '2026-09-03' });
  assert.deepEqual(q.map((r) => r.item_id), ['b2', 'b3', 'c1', 'c2']);
});

test('today_queue：scope_override 也能把条目挡在队列外', () => {
  const q = R.today_queue(fakeItems(), { a1: { scope_override: 'thin' } }, {}, { day: '2026-09-03' });
  assert.ok(!q.some((r) => r.item_id === 'a1'));
});

test('today_queue：review_cap 4 —— due 的先来，然后才轮到新条目', () => {
  const states = {};
  for (const id of ['a1', 'a2', 'b1', 'b2', 'c1']) {
    states[id] = { n_takes: 2, due_on: '2026-09-01' };
  }
  const q = R.today_queue(fakeItems(), states, {}, { day: '2026-09-03' });
  // due 池按 (due_on, item_id) 排；每场至多 2 条 → a1 a2 b1 b2，review_cap 用满
  assert.deepEqual(q.slice(0, 4).map((r) => r.item_id), ['a1', 'a2', 'b1', 'b2']);
  assert.equal(q.length, 6);
  assert.deepEqual(q.slice(4).map((r) => r.item_id), ['c2', 'c3'], 'c1 已 due 但 C 场配额只剩 2');
});

test('today_queue：欠超过 overdue_cap_days 的就地重置成今天', () => {
  const states = { a1: { n_takes: 1, due_on: '2026-08-01' } };
  const reset = [];
  const q = R.today_queue(fakeItems(), states, {}, {
    day: '2026-09-03', onReset: (ids) => reset.push(...ids),
  });
  assert.deepEqual(reset, ['a1']);
  assert.equal(q.find((r) => r.item_id === 'a1').due_on, '2026-09-03');
});

test('today_queue：未来到期的复习条目不进队列', () => {
  const q = R.today_queue(fakeItems(), { a1: { n_takes: 1, due_on: '2026-12-01' } }, {}, { day: '2026-09-03' });
  assert.ok(!q.some((r) => r.item_id === 'a1'));
});

// ---------------------------------------------------------------- 校准 / 直方图

test('calibrating_now：take 数或天数任一到线就结束', async () => {
  assert.equal(await R.calibrating_now(memStore({}, []), {}), true);
  const many = Array.from({ length: 20 }, (_, i) => ({
    take_id: `t_00000000000${String(i).padStart(2, '0')}_a`, first_exposure: 0, ts: '2026-09-03T00:00:00-07:00',
  }));
  assert.equal(await R.calibrating_now(memStore({}, many), {}), false);
  const old = [{ take_id: 't_0000000000001_a', first_exposure: 0, ts: '2026-08-01T00:00:00-07:00' }];
  assert.equal(await R.calibrating_now(memStore({}, old), {}, { day: '2026-09-03' }), false);
  assert.equal(await R.calibrating_now(memStore({}, []), { recite: { calibrating: false } }), false);
});

test('histogram：分母只含 first_exposure=0 且 mode=recall，原版/变体分开', () => {
  const takes = [
    { take_id: 't_3', variant_type: 'original', passed: 1, total: 4.2, verbatim_ratio: 0.3, dur_sec: 60, first_exposure: 0, mode: 'recall' },
    { take_id: 't_2', variant_type: 'constraint', passed: 0, total: 3.0, verbatim_ratio: 0.5, dur_sec: 30, first_exposure: 0, mode: 'recall' },
    { take_id: 't_1', variant_type: 'original', passed: 1, total: 5.0, verbatim_ratio: 0.1, dur_sec: 30, first_exposure: 1, mode: 'recall' },
    { take_id: 't_0', variant_type: 'original', passed: 1, total: 5.0, verbatim_ratio: 0.1, dur_sec: 30, first_exposure: 0, mode: 'read' },
  ];
  const h = R.histogram(takes);
  assert.deepEqual(h.buckets.map((b) => [b.name, b.n, b.pass_rate]), [['原版', 1, 100], ['变体', 1, 0]]);
  assert.equal(h.spoken_min, 1.5);
  assert.deepEqual(h.r_trend, [0.5, 0.3]);
});

// ---------------------------------------------------------------- 口径

test('fact_check：白名单外的百分数是 soft，banned 说法是 hard', () => {
  const numbers = {
    allowed: [{ value: '30', story: 'A2', canonical: 'cutting invalid submissions by 30%' }],
    banned_phrases: ['幂等框架'],
  };
  const out = R.fact_check('we cut it by 40 percent using 幂等框架', { story_id: 'A2' }, numbers);
  assert.equal(out.length, 2);
  assert.equal(out[0].level, 'soft');
  assert.match(out[0].note, /上次你说的是 30%/);
  assert.equal(out[1].level, 'hard');
  assert.deepEqual(R.number_flag_strings(out), ['banned:幂等框架']);
  assert.deepEqual(R.fact_check('we cut it by 30%', { story_id: 'A2' }, numbers), []);
});

// ---------------------------------------------------------------- 日期

test('today / plus / shift 走 America/Los_Angeles', () => {
  // UTC 2026-09-03T05:00Z = LA 2026-09-02T22:00
  assert.equal(R.today(new Date('2026-09-03T05:00:00Z')), '2026-09-02');
  assert.equal(R.plus(3, '2026-09-30'), '2026-10-03');
  assert.equal(R.shift(-7, '2026-09-03'), '2026-08-27');
  assert.match(R.now_iso(new Date('2026-09-03T05:00:00Z')), /^2026-09-02T22:00:00-07:00$/);
});
