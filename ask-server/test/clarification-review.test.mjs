import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import {
  ClarificationReviewer,
  ReviewRateLimitError,
  ReviewRequestLedger,
  normalizeClarificationReview,
} from '../clarification-review.mjs';
import { readBody } from '../request-body.mjs';

const rubric = {
  version: 'test-v1',
  problem: 'Design a three-day donation system.',
  rubric: [
    { id: 'time-window', label: '截止语义', question: '固定窗口与时区？', impact: '决定服务器截止判断。' },
    { id: 'payment-finality', label: '付款归属', question: '截止前发起、截止后成功怎么办？', impact: '决定状态机。' },
    { id: 'total-semantics', label: '总额口径', question: '总额算什么、慢多久？', impact: '决定读模型。' },
  ],
  expectedAssumptions: ['服务端 UTC 截止。'],
};

const answer = [
  '三天是固定 72 小时 UTC 吗？',
  '截止前发起、截止后成功是否计入？',
  '公开总额只算 captured 吗，允许慢几秒？',
  '我先用 Postgres 还是 Kafka？',
].join('\n');

test('normalizer keeps only trusted criteria and evidence that was actually written', () => {
  const result = normalizeClarificationReview({
    summary: '三个会改变设计的边界已经问到。',
    covered: [
      { id: 'time-window', evidence: '三天是固定 72 小时 UTC 吗？', why: '截止逻辑不同。' },
      { id: 'not-a-real-id', evidence: 'invented', why: 'must disappear' },
      { id: 'payment-finality', evidence: '我问了退款。', why: 'must disappear because not in answer' },
    ],
    missed: [
      { id: 'total-semantics', why: '还不知道公开总额算什么。' },
      { id: 'time-window', why: 'covered must not also be missed' },
    ],
    lowValue: [{ label: '先选数据库', evidence: '我先用 Postgres 还是 Kafka？', why: '需求没锁定前不改变范围。' }],
    riskyAssumptions: [{ label: '默认即时结算', evidence: '截止前发起、截止后成功是否计入？', why: '这里仍未锁定。' }],
    nextQuestion: '公开总额只算 captured 吗，最多允许慢多久？',
    scopeLine: '我先假设服务端 UTC 截止，且首版不做 split donation。',
  }, {
    cardId: 'card-1', rubricVersion: rubric.version, requestId: 'request-1', rubric, answer,
  });

  assert.deepEqual(result?.covered.map((item) => item.id), ['time-window']);
  assert.deepEqual(result?.missed.map((item) => item.id), ['total-semantics']);
  assert.equal(result?.lowValue.length, 1);
  assert.equal(result?.riskyAssumptions.length, 1);
});

test('reviewer parses a valid model response and removes unsupported claims', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    content: [{ type: 'text', text: JSON.stringify({
      summary: '你锁住了时间窗口，但付款归属还没有定。',
      covered: [{ id: 'time-window', evidence: '三天是固定 72 小时 UTC 吗？', why: '影响截止判定。' }],
      missed: [{ id: 'payment-finality', why: '会影响状态机。' }],
      lowValue: [],
      riskyAssumptions: [],
      nextQuestion: '截止前创建但截止后成功的付款是否计入？',
      scopeLine: '我先假设服务端按 UTC 截止，且首版不做 split donation。',
    }) }],
  }), { status: 200 });
  const reviewer = new ClarificationReviewer({ apiKey: 'sk-ant-test', fetchImpl });
  const result = await reviewer.review({
    cardId: 'card-1', rubricVersion: rubric.version, answer, requestId: 'request-2', rubric,
  });
  assert.equal(result.covered[0].id, 'time-window');
  assert.equal(result.missed[0].id, 'payment-finality');
});

test('ledger shares idempotent work and enforces the per-key quota', async () => {
  let now = 0;
  const ledger = new ReviewRequestLedger({ now: () => now, limit: 2, windowMs: 1000 });
  let calls = 0;
  const work = async () => ({ value: ++calls });

  assert.deepEqual(await ledger.run('token', 'same', work), { value: 1 });
  assert.deepEqual(await ledger.run('token', 'same', work), { value: 1 });
  assert.equal(calls, 1);
  await ledger.run('token', 'other', work);
  await assert.rejects(() => ledger.run('token', 'third', work), ReviewRateLimitError);
  now = 1001;
  assert.deepEqual(await ledger.run('token', 'fresh-window', work), { value: 3 });
});

test('oversized review bodies reject with 413 without destroying the response path', async () => {
  const request = Readable.from([Buffer.alloc(9000, 'x')]);
  await assert.rejects(
    () => readBody(request, 8 * 1024),
    (error) => error?.status === 413,
  );
});
