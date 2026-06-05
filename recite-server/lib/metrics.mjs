// 音频指标。**替换掉 recite.py::audio_metrics 的 ffprobe + ffmpeg silencedetect**（M4 §2）：
// Cloud Run 上不装 ffmpeg，停顿改由 STT 的 word timestamps 推。
//
// 口径（M4 §2 的替换清单）：
//   · duration      = max(客户端录音器上报的时长, 末词 end)  —— 转写末词只用来校正，不用来缩短
//   · 相邻词间隔 ≥ 0.6s 记作静音（对齐 ffmpeg 的 `silencedetect=noise=-32dB:d=0.6`）
//   · 间隔 ≥ 2.0s 记作一次「停顿」，和 Python 的 pauses_over_2s 同义
//   · speaking_sec  = duration − Σ(静音)
//
// DEVIATION: Python 把首尾静音也算进 silence（ffmpeg 从 0 秒起测）。这里把「第一个词之前」和
// 「最后一个词之后」的空白同样计入静音，好让 speaking_ratio 的量级和 ffmpeg 版可比。

const SILENCE_MIN = 0.6;
const PAUSE_MIN = 2.0;

export function audio_metrics({ duration_sec = 0, words = [] } = {}) {
  const out = {
    duration: 0.0,
    speaking_sec: 0.0,
    pauses_over_2s: 0,
    longest_pause_sec: 0.0,
    speaking_ratio: 0.0,
  };
  const ws = (words || [])
    .filter((w) => w && Number.isFinite(Number(w.start)) && Number.isFinite(Number(w.end)))
    .map((w) => ({ start: Number(w.start), end: Number(w.end) }))
    .sort((a, b) => a.start - b.start);

  const lastEnd = ws.length ? ws[ws.length - 1].end : 0;
  const duration = Math.max(Number(duration_sec) || 0, lastEnd);
  out.duration = round2(duration);
  if (!duration) return out;

  if (!ws.length) {
    // 没有词时间戳（转写失败 / 引擎不给）—— 指标缺失绝不能吃掉一次录音，退回「全程都在说」。
    out.speaking_sec = out.duration;
    out.speaking_ratio = 1.0;
    return out;
  }

  const gaps = [];
  let prev = 0;
  for (const w of ws) {
    gaps.push(w.start - prev);
    prev = Math.max(prev, w.end);
  }
  gaps.push(duration - prev);

  const silences = gaps.filter((g) => g >= SILENCE_MIN);
  const silence = silences.reduce((a, g) => a + g, 0);
  const pauses = silences.filter((g) => g >= PAUSE_MIN);
  out.pauses_over_2s = pauses.length;
  out.longest_pause_sec = silences.length ? round2(Math.max(...silences)) : 0.0;
  out.speaking_sec = round2(Math.max(0.0, duration - silence));
  out.speaking_ratio = Math.round((out.speaking_sec / duration) * 1000) / 1000;
  return out;
}

function round2(x) {
  return Math.round(x * 100) / 100;
}
