// 转写。Google Speech-to-Text v2（chirp_2），替换 jobscan 的 Parakeet 子进程（M4 §2）。
//
// 契约和 recite_asr.py 一致，多返回词时间戳：{text, engine, error, words:[{w,start,end}]}。
// **转写失败绝不能吃掉一次录音**：任何异常都返回结构完整的对象，绝不抛。
//
// 路由：
//   ≤60s（按客户端上报的时长）→ recognize，音频 inline
//   >60s                      → batchRecognize 读 GCS 对象，inlineResponseConfig 直接回结果（等 LRO）
//   任一步在 chirp_2 上出错    → 退一次 model `long` 重试
//
// FileMedia 模式下没有 GCS URI，>60s 也只能走 recognize —— v2 的 inline content 上限约 10MB，
// 一段 90 秒的 opus 远在其下，所以本地跑不会因此失败；真正会被这条打到的是超长录音。

const RECOGNIZE_MAX_SEC = 60;

function offsetSec(d) {
  if (!d) return null;
  const s = Number(d.seconds || 0);
  const n = Number(d.nanos || 0);
  return s + n / 1e9;
}

function collect(results) {
  const parts = [];
  const words = [];
  for (const r of results || []) {
    const alt = (r.alternatives || [])[0];
    if (!alt) continue;
    if (alt.transcript) parts.push(alt.transcript.trim());
    for (const w of alt.words || []) {
      const start = offsetSec(w.startOffset);
      const end = offsetSec(w.endOffset);
      if (start === null || end === null) continue;
      words.push({ w: w.word || '', start, end });
    }
  }
  return { text: parts.join(' ').trim(), words };
}

export class GoogleStt {
  /**
   * @param {object} opts
   *  project   GCP_PROJECT
   *  location  STT_LOCATION（默认 us-central1）
   *  model     STT_MODEL（默认 chirp_2）
   *  client    可注入的 v2 SpeechClient（测试用）
   */
  constructor({ project, location = 'us-central1', model = 'chirp_2', client = null } = {}) {
    this.project = project;
    this.location = location;
    this.model = model;
    this._client = client;
  }

  get recognizer() {
    return `projects/${this.project}/locations/${this.location}/recognizers/_`;
  }

  async client() {
    if (!this._client) {
      const speech = await import('@google-cloud/speech');
      // 区域端点是必须的：默认的 speech.googleapis.com 上没有 us-central1 的 `_` recognizer。
      this._client = new speech.v2.SpeechClient({
        apiEndpoint: `${this.location}-speech.googleapis.com`,
      });
    }
    return this._client;
  }

  config(model) {
    return {
      autoDecodingConfig: {},
      model,
      languageCodes: ['en-US'],
      features: {
        enableWordTimeOffsets: true,
        enableAutomaticPunctuation: true,
      },
    };
  }

  async _recognizeInline(bytes, model) {
    const client = await this.client();
    const [resp] = await client.recognize({
      recognizer: this.recognizer,
      config: this.config(model),
      content: Buffer.from(bytes),
    });
    return collect(resp.results);
  }

  async _batch(gcsUri, model) {
    const client = await this.client();
    const [op] = await client.batchRecognize({
      recognizer: this.recognizer,
      config: this.config(model),
      files: [{ uri: gcsUri }],
      recognitionOutputConfig: { inlineResponseConfig: {} },
    });
    const [resp] = await op.promise();
    const file = Object.values(resp.results || {})[0] || {};
    if (file.error && file.error.message) throw new Error(`batch: ${file.error.message}`);
    // v2 把结果放在 `transcript`；旧字段名 `inlineResult.transcript` 仍会出现在部分响应里。
    const t = file.transcript || (file.inlineResult && file.inlineResult.transcript) || {};
    return collect(t.results);
  }

  /** @returns {Promise<{text,engine,error,words}>} 绝不抛。 */
  async transcribe({ bytes, gcsUri = null, duration_sec = 0 }) {
    const blank = { text: '', engine: '', error: '', words: [] };
    const attempts = [this.model];
    if (this.model !== 'long') attempts.push('long'); // chirp_2 出错退一次 long
    const errors = [];
    for (const model of attempts) {
      try {
        const useBatch = Number(duration_sec) > RECOGNIZE_MAX_SEC && gcsUri;
        const got = useBatch
          ? await this._batch(gcsUri, model)
          : await this._recognizeInline(bytes, model);
        return { ...got, engine: `stt-v2:${model}`, error: errors.join(' / ') };
      } catch (e) {
        errors.push(`${model}: ${String((e && e.message) || e).slice(0, 200)}`);
      }
    }
    return { ...blank, error: errors.join(' / ') };
  }
}

/** 测试/离线用的桩。只在 RECITE_STUB_STT=1 时被选中，生产路径永远走不到。 */
export class StubStt {
  constructor(canned) {
    this.canned = canned || {
      text: 'I owned the campaign setup system and modeled it as a state problem.',
      engine: 'stub',
      error: '',
      words: [
        { w: 'I', start: 0.0, end: 0.2 },
        { w: 'owned', start: 0.25, end: 0.6 },
        { w: 'the', start: 3.0, end: 3.1 },
        { w: 'system', start: 3.2, end: 3.8 },
      ],
    };
  }

  async transcribe() {
    return { ...this.canned };
  }
}

export function makeStt(env = process.env) {
  if (env.RECITE_STUB_STT === '1') return new StubStt();
  return new GoogleStt({
    project: env.GCP_PROJECT || env.GOOGLE_CLOUD_PROJECT,
    location: env.STT_LOCATION || 'us-central1',
    model: env.STT_MODEL || 'chirp_2',
  });
}
