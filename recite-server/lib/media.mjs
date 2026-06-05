// 音频存放。GcsMedia（私有桶，只经服务端 Range 透传）/ FileMedia（本地跑和测试）。
// 接口：put(name, bytes, contentType) stat(name) stream(name, {start,end}) exists(name) gcsUri(name)
// `name` 是相对桶根的对象名：`orig/<item_id>.mp3` / `dialog/<item_id>.mp3` / `takes/<file>`。

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const SLOTS = ['orig', 'dialog', 'takes'];

export class FileMedia {
  constructor(dir) {
    this.dir = dir;
    for (const s of SLOTS) fs.mkdirSync(path.join(dir, s), { recursive: true });
  }

  _p(name) {
    const p = path.resolve(this.dir, name);
    // 路径必须落在 media 根之内 —— 这个目录装的是她的录音，不能被 `../` 撬开。
    if (!p.startsWith(path.resolve(this.dir) + path.sep)) throw new Error('bad media name');
    return p;
  }

  async put(name, bytes, contentType) {
    const p = this._p(name);
    await fsp.mkdir(path.dirname(p), { recursive: true });
    await fsp.writeFile(p, bytes);
    return { name, size: bytes.length, contentType };
  }

  async stat(name) {
    try {
      const s = await fsp.stat(this._p(name));
      return { size: s.size, contentType: guessType(name) };
    } catch {
      return null;
    }
  }

  async exists(name) {
    return (await this.stat(name)) !== null;
  }

  stream(name, { start, end } = {}) {
    return fs.createReadStream(this._p(name), start === undefined ? {} : { start, end });
  }

  // 本地模式没有 GCS 对象 —— batchRecognize 走不了，见 lib/stt.mjs 的说明。
  gcsUri() {
    return null;
  }
}

export class GcsMedia {
  constructor(bucketName, storage) {
    this.bucketName = bucketName;
    this.storage = storage;
    this.bucket = storage.bucket(bucketName);
  }

  async put(name, bytes, contentType) {
    await this.bucket.file(name).save(Buffer.from(bytes), {
      contentType,
      resumable: false,
    });
    return { name, size: bytes.length, contentType };
  }

  async stat(name) {
    try {
      const [md] = await this.bucket.file(name).getMetadata();
      return { size: Number(md.size || 0), contentType: md.contentType || guessType(name) };
    } catch {
      return null;
    }
  }

  async exists(name) {
    const [ok] = await this.bucket.file(name).exists();
    return ok;
  }

  stream(name, { start, end } = {}) {
    return this.bucket.file(name).createReadStream(start === undefined ? {} : { start, end });
  }

  gcsUri(name) {
    return `gs://${this.bucketName}/${name}`;
  }
}

export function guessType(name) {
  const ext = path.extname(name).toLowerCase();
  return {
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.mp4': 'audio/mp4',
    '.webm': 'audio/webm',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
  }[ext] || 'application/octet-stream';
}

export async function makeMedia(env = process.env) {
  if (env.RECITE_MEDIA_DIR) return new FileMedia(env.RECITE_MEDIA_DIR);
  if (!env.RECITE_BUCKET) throw new Error('set RECITE_BUCKET (or RECITE_MEDIA_DIR for local)');
  const { Storage } = await import('@google-cloud/storage');
  return new GcsMedia(env.RECITE_BUCKET, new Storage());
}
