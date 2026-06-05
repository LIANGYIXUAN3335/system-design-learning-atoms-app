import test from 'node:test';
import assert from 'node:assert/strict';
import { audio_metrics } from '../lib/metrics.mjs';
import { wpm } from '../lib/recite.mjs';

test('audio_metrics：≥0.6s 的词间隔算静音，≥2s 的算一次停顿', () => {
  const words = [
    { w: 'a', start: 0.0, end: 1.0 },
    { w: 'b', start: 1.2, end: 2.0 },   // 0.2s 间隔 —— 不是静音
    { w: 'c', start: 5.0, end: 6.0 },   // 3.0s 间隔 —— 一次停顿
    { w: 'd', start: 6.8, end: 8.0 },   // 0.8s 间隔 —— 静音但不是停顿
  ];
  const m = audio_metrics({ duration_sec: 8, words });
  assert.equal(m.duration, 8);
  assert.equal(m.pauses_over_2s, 1);
  assert.equal(m.longest_pause_sec, 3);
  assert.equal(m.speaking_sec, 8 - 3.0 - 0.8);
  assert.equal(m.speaking_ratio, 0.525);
});

test('audio_metrics：duration = max(客户端上报, 末词 end)', () => {
  const words = [{ w: 'a', start: 0, end: 30 }];
  assert.equal(audio_metrics({ duration_sec: 10, words }).duration, 30);
  assert.equal(audio_metrics({ duration_sec: 45, words }).duration, 45);
});

test('audio_metrics：首尾空白也计入静音', () => {
  const m = audio_metrics({ duration_sec: 10, words: [{ w: 'a', start: 3, end: 4 }] });
  assert.equal(m.speaking_sec, 1);        // 前 3s + 后 6s 都是静音
  assert.equal(m.pauses_over_2s, 2);
  assert.equal(m.longest_pause_sec, 6);
});

test('audio_metrics：没有词时间戳时退回「全程都在说」—— 指标缺失不吃录音', () => {
  const m = audio_metrics({ duration_sec: 42, words: [] });
  assert.deepEqual(m, {
    duration: 42, speaking_sec: 42, pauses_over_2s: 0, longest_pause_sec: 0, speaking_ratio: 1,
  });
  assert.equal(audio_metrics({}).duration, 0);
});

test('wpm 用 speaking_sec 而不是 duration', () => {
  const m = audio_metrics({ duration_sec: 60, words: [{ w: 'a', start: 0, end: 30 }] });
  assert.equal(m.speaking_sec, 30);
  assert.equal(wpm('one two three four five', m), 10);
});
