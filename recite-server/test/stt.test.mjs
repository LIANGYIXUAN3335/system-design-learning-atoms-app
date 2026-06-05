// STT 的请求形状用**装好的 proto** 校验，不靠记忆：字段名写错时 verify() 会立刻报出来，
// 而不是等到线上返回一段空转写。

import test from 'node:test';
import assert from 'node:assert/strict';
import speech from '@google-cloud/speech';

import { GoogleStt, StubStt, makeStt } from '../lib/stt.mjs';

const V2 = speech.protos.google.cloud.speech.v2;
const stt = new GoogleStt({ project: 'p', location: 'us-central1', model: 'chirp_2', client: {} });

test('recognizer 路径和区域端点', () => {
  assert.equal(stt.recognizer, 'projects/p/locations/us-central1/recognizers/_');
  assert.deepEqual(stt.config('chirp_2'), {
    autoDecodingConfig: {},
    model: 'chirp_2',
    languageCodes: ['en-US'],
    features: { enableWordTimeOffsets: true, enableAutomaticPunctuation: true },
  });
});

test('RecognizeRequest 通过 v2 proto 校验', () => {
  const req = {
    recognizer: stt.recognizer,
    config: stt.config('chirp_2'),
    content: Buffer.from('abc'),
  };
  assert.equal(V2.RecognizeRequest.verify(req), null);
  assert.equal(V2.RecognitionConfig.verify(req.config), null);
  assert.equal(V2.RecognitionFeatures.verify(req.config.features), null);
});

test('BatchRecognizeRequest（inlineResponseConfig）通过 v2 proto 校验', () => {
  const req = {
    recognizer: stt.recognizer,
    config: stt.config('long'),
    files: [{ uri: 'gs://example-bucket/takes/x.webm' }],
    recognitionOutputConfig: { inlineResponseConfig: {} },
  };
  assert.equal(V2.BatchRecognizeRequest.verify(req), null);
  assert.equal(V2.RecognitionOutputConfig.verify(req.recognitionOutputConfig), null);
});

test('写错字段名会被 proto 挡下来（这就是"失败要响"的意思）', () => {
  assert.notEqual(V2.RecognitionFeatures.verify({ enableWordTimeOffsets: 'yes' }), null);
  assert.notEqual(V2.RecognizeRequest.verify({ recognizer: 42 }), null);
});

test('≤60s 走 recognize；>60s 且有 GCS 对象才走 batchRecognize', async () => {
  const calls = [];
  const fake = {
    async recognize(req) {
      calls.push(['recognize', req]);
      return [{ results: [{ alternatives: [{ transcript: 'hello there', words: [
        { word: 'hello', startOffset: { seconds: 0, nanos: 0 }, endOffset: { seconds: 0, nanos: 5e8 } },
        { word: 'there', startOffset: { seconds: 1 }, endOffset: { seconds: 2 } },
      ] }] }] }];
    },
    async batchRecognize(req) {
      calls.push(['batch', req]);
      return [{ promise: async () => [{ results: { 'gs://b/x': { transcript: {
        results: [{ alternatives: [{ transcript: 'from batch', words: [] }] }],
      } } } }] }];
    },
  };
  const s = new GoogleStt({ project: 'p', client: fake });

  const short = await s.transcribe({ bytes: Buffer.from('a'), gcsUri: 'gs://b/x', duration_sec: 40 });
  assert.equal(calls.at(-1)[0], 'recognize');
  assert.equal(short.text, 'hello there');
  assert.equal(short.engine, 'stt-v2:chirp_2');
  assert.deepEqual(short.words, [
    { w: 'hello', start: 0, end: 0.5 },
    { w: 'there', start: 1, end: 2 },
  ]);

  const long = await s.transcribe({ bytes: null, gcsUri: 'gs://b/x', duration_sec: 90 });
  assert.equal(calls.at(-1)[0], 'batch');
  assert.equal(long.text, 'from batch');

  // FileMedia 模式：没有 GCS 对象 → 长录音也只能 inline
  await s.transcribe({ bytes: Buffer.from('a'), gcsUri: null, duration_sec: 90 });
  assert.equal(calls.at(-1)[0], 'recognize');
});

test('chirp_2 出错退一次 long；两个都挂 → 空转写 + error，不抛', async () => {
  const models = [];
  const flaky = {
    async recognize(req) {
      models.push(req.config.model);
      if (req.config.model === 'chirp_2') throw new Error('model unavailable');
      return [{ results: [{ alternatives: [{ transcript: 'fallback', words: [] }] }] }];
    },
  };
  const ok = await new GoogleStt({ project: 'p', client: flaky }).transcribe({ bytes: Buffer.from('a') });
  assert.deepEqual(models, ['chirp_2', 'long']);
  assert.equal(ok.text, 'fallback');
  assert.equal(ok.engine, 'stt-v2:long');
  assert.match(ok.error, /chirp_2: model unavailable/);

  const dead = { async recognize() { throw new Error('nope'); } };
  const bad = await new GoogleStt({ project: 'p', client: dead }).transcribe({ bytes: Buffer.from('a') });
  assert.equal(bad.text, '');
  assert.equal(bad.engine, '');
  assert.match(bad.error, /chirp_2: nope \/ long: nope/);
});

test('makeStt：桩必须显式开', () => {
  assert.ok(makeStt({ RECITE_STUB_STT: '1' }) instanceof StubStt);
  assert.ok(makeStt({ GCP_PROJECT: 'p' }) instanceof GoogleStt);
  assert.equal(makeStt({ GCP_PROJECT: 'p' }).model, 'chirp_2');
  assert.equal(makeStt({ GCP_PROJECT: 'p', STT_MODEL: 'long', STT_LOCATION: 'us' }).location, 'us');
});
