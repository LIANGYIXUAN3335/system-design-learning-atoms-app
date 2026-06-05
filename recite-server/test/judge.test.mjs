import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RECITE_SYSTEM, extractJson, rejectReview, buildUserPrompt, AnthropicJudge, makeJudge, StubJudge,
} from '../lib/judge.mjs';

test('system prompt 与 ai.py::_RECITE_SYSTEM 逐字节一致', () => {
  assert.equal(RECITE_SYSTEM.length, 4280);
  assert.ok(RECITE_SYSTEM.startsWith('You are a senior FAANG interviewer debriefing ONE spoken answer from a mock-interview drill.'));
  assert.ok(RECITE_SYSTEM.includes('COVERAGE — you do NOT score this dimension. You only output `missed_cues`.'));
  assert.ok(RECITE_SYSTEM.includes('A 5 without a verbatim quote will be reduced to 3 by the caller.'));
  assert.ok(RECITE_SYSTEM.endsWith('from the transcript in English.\n'));
  // ai.py 里 system 是 `_RECITE_SYSTEM + _lessons()`；_lessons() 不搬（M4 §2），所以这里
  // 送出去的 system 必须**等于** RECITE_SYSTEM 本身（下面 8000→3000 那条断言逐字比对）。
  assert.ok(!/LESSON/i.test(RECITE_SYSTEM));
});

test('extractJson 剥 ``` 围栏并取最外层花括号', () => {
  assert.equal(extractJson('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(extractJson('胡说八道 {"a": {"b": 2}} 后面还有字'), '{"a": {"b": 2}}');
  assert.equal(extractJson('完全没有 JSON'), '{}');
});

test('rejectReview：空洞夸奖 / 空 issues / 泛泛 fix_next 全部被记账', () => {
  const d = { scores: { structure: 4 }, issues: [], fix_next: 'be more concise', evidence: {} };
  const fixed = rejectReview(d);
  assert.ok(fixed.includes('empty_issues'));
  assert.ok(fixed.includes('vague_fix'));
  assert.equal(d.issues.length, 1);

  assert.ok(rejectReview({ scores: {}, issues: ['x'], fix_next: 'ok', evidence: {}, one_line: 'great job 你很棒' })
    .includes('praise'));
  assert.ok(rejectReview({ scores: {}, issues: ['x'], fix_next: '在 40 秒处收口 and also 少说数字', evidence: {} })
    .includes('vague_fix'));
  assert.ok(!rejectReview({ scores: {}, issues: ['x'], fix_next: '在 40 秒处直接进落点', evidence: {} })
    .includes('vague_fix'));
});

test('rejectReview：没有 TRANSCRIPT 逐字引证的 5 分被降到 3', () => {
  const d = {
    scores: { structure: 5, concision: 5, fluency: 4 },
    issues: ['x'], fix_next: '在 40 秒处收口',
    evidence: { structure: '开头就落点了', concision: 'she said "one idea per sentence here"' },
  };
  const fixed = rejectReview(d);
  assert.equal(d.scores.structure, 3);
  assert.equal(d.scores.concision, 5, '带引证的 5 分保留');
  assert.equal(d.scores.fluency, 4);
  assert.deepEqual(fixed.filter((f) => f.startsWith('unquoted_5')), ['unquoted_5:structure']);
});

test('buildUserPrompt：变体档 / why line / undertime / pace 段按条件出现', () => {
  const base = {
    question: 'Tell me about yourself', scored_cues: ['a', 'b'], delivery_notes: ['慢一点'],
    script: 'S', transcript: 'T', metrics: { duration: 60, pauses_over_2s: 1, longest_pause_sec: 2.5 },
    target_sec: 60, wpm: 130,
  };
  const p = buildUserPrompt(base);
  assert.ok(p.includes('CUE POINTS she was aiming at'));
  assert.ok(p.includes('  - a\n  - b'));
  assert.ok(p.includes('DELIVERY NOTES (judge under structure, never in missed_cues)'));
  assert.ok(p.includes('duration 60s against a 60s target'));
  assert.ok(p.includes('speaking rate 130.0 wpm · pauses over 2s: 1 · longest pause 2.5s'));
  assert.ok(!p.includes('VARIANT —'));
  assert.ok(!p.includes('WHY LINE'));
  assert.ok(!p.includes('PACE —'));

  const v = buildUserPrompt({ ...base, variant_type: 'truncate', variant_sec: 40, variant_hint: 'H' });
  assert.ok(v.includes('VARIANT — this take was recorded under a variant constraint'));
  assert.ok(v.includes('Time allowed: 40s (the original target was 60s).'));

  const w = buildUserPrompt({ ...base, why_line: '因为延迟', why_q: '为什么？' });
  assert.ok(w.includes('WHY LINE'));
  assert.ok(w.includes('"""因为延迟"""'));

  const u = buildUserPrompt({ ...base, metrics: { ...base.metrics, duration: 20 } });
  assert.ok(u.includes('This take ran 20s against a 60s target.'));

  assert.ok(buildUserPrompt({ ...base, pace: 'deliberate' }).includes('PACE — this script is deliberately slow'));
  assert.ok(buildUserPrompt({ ...base, speaker_name: 'Lisa' })
    .includes('In this interview the interviewer called her Lisa.'));
  assert.ok(buildUserPrompt({ ...base, scored_cues: [] }).includes('  (no cue points)'));
});

test('AnthropicJudge：没有 key 时返回空卡而不是抛', async () => {
  const r = await new AnthropicJudge({ apiKey: '' }).reviewTake({});
  assert.equal(r.error, 'ai disabled or no api key');
  assert.deepEqual(r.scores, {});
});

test('AnthropicJudge：8000 + thinking 拿不到文本时退一次 3000 不 thinking', async () => {
  const calls = [];
  const client = {
    messages: {
      async create(req) {
        calls.push(req);
        return calls.length === 1
          ? { content: [{ type: 'thinking', thinking: '……' }] }
          : { content: [{ type: 'text', text: '{"scores":{"structure":4,"concision":4,"fluency":4,"why_depth":4},"issues":["x"],"fix_next":"在 40 秒处收口","evidence":{},"missed_cues":[],"one_line":"ok"}' }] };
      },
    },
  };
  const judge = new AnthropicJudge({ apiKey: 'k', client });
  const out = await judge.reviewTake({ question: 'Q', transcript: 'T', metrics: {} });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].model, 'claude-opus-4-8');
  assert.equal(calls[0].max_tokens, 8000);
  assert.deepEqual(calls[0].thinking, { type: 'adaptive' });
  assert.deepEqual(calls[0].output_config, { effort: 'high' });
  assert.equal(calls[0].system, RECITE_SYSTEM);
  assert.equal(calls[1].max_tokens, 3000);
  assert.equal(calls[1].thinking, undefined);
  assert.equal(out.scores.structure, 4);
  assert.equal(out.error, '');
});

test('AnthropicJudge：模型爆炸 / 没返回 scores → 空卡 + error，不抛', async () => {
  const boom = new AnthropicJudge({
    apiKey: 'k',
    client: { messages: { async create() { throw new TypeError('boom'); } } },
  });
  const r = await boom.reviewTake({});
  assert.match(r.error, /TypeError: boom/);
  assert.deepEqual(r.scores, {});

  const empty = new AnthropicJudge({
    apiKey: 'k',
    client: { messages: { async create() { return { content: [{ type: 'text', text: '{"issues":[]}' }] }; } } },
  });
  assert.equal((await empty.reviewTake({})).error, '判官没返回 scores');
});

test('makeJudge：桩必须显式开，生产路径拿不到它', () => {
  assert.ok(makeJudge({ RECITE_STUB_JUDGE: '1' }) instanceof StubJudge);
  assert.ok(makeJudge({ ANTHROPIC_API_KEY: 'k' }) instanceof AnthropicJudge);
  assert.ok(makeJudge({}) instanceof AnthropicJudge);
});
