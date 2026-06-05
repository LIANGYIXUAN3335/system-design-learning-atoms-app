import { Platform } from 'react-native';
import { clearToken, ensureToken, peekToken, tokenConfigured } from './token';
import type {
  ReciteItemStatus,
  ReciteMarkAction,
  ReciteMode,
  ReciteOverview,
  ReciteScoreResult,
  ReciteTakeMeta,
  ReciteUploadResult,
} from './types';

/**
 * atoms-recite 的客户端。契约见 docs/M4-recite.md §3.3。
 *
 * 这是 Atoms 里唯一联网才能用的一块：录音、转写、判官本来就不可能离线。服务不可达时
 * 库照样打得开（内容在 bundle 里），只是不能录、不能评 —— 所以这里每个错误都必须是
 * 一句她看得懂的中文，绝不能吞掉变成静默失败。
 */

const rawBase = typeof process !== 'undefined' ? process.env.EXPO_PUBLIC_ATOM_RECITE_URL : undefined;
const base = rawBase ? rawBase.replace(/\/$/, '') : '';

export function reciteBaseUrl(): string {
  return base;
}

/** 有服务地址 + 有口令来源，才谈得上录音和评分。 */
export function reciteConfigured(): boolean {
  return Boolean(base) && tokenConfigured();
}

function requireBase(): string {
  if (!base) {
    throw new Error('没有配 EXPO_PUBLIC_ATOM_RECITE_URL —— 录音和评分要联网，先设好服务地址');
  }
  return base;
}

function requireToken(): string {
  const token = ensureToken();
  if (!token) throw new Error('没有同步口令 —— 录音和评分要口令，和卡片同步用同一个');
  return token;
}

async function readError(res: Response): Promise<string> {
  try {
    const text = (await res.text()).trim();
    return text.slice(0, 200);
  } catch {
    return '';
  }
}

async function handle<T>(res: Response, what: string): Promise<T> {
  if (res.status === 401 || res.status === 403) {
    clearToken();
    throw new Error(`${what}：口令不对（${res.status}）—— 刷新页面后重新输入口令`);
  }
  if (!res.ok) {
    const detail = await readError(res);
    throw new Error(`${what}：服务返回 ${res.status}${detail ? ` —— ${detail}` : ''}`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${what}：服务返回的不是 JSON —— 服务地址可能填错了`);
  }
}

function netError(what: string, e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  return new Error(`${what}：连不上评分服务（${msg}）—— 检查网络或 EXPO_PUBLIC_ATOM_RECITE_URL`);
}

async function getJson<T>(path: string, what: string): Promise<T> {
  const url = `${requireBase()}${path}`;
  const token = requireToken();
  let res: Response;
  try {
    res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  } catch (e) {
    throw netError(what, e);
  }
  return handle<T>(res, what);
}

async function postJson<T>(path: string, body: unknown, what: string): Promise<T> {
  const url = `${requireBase()}${path}`;
  const token = requireToken();
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body ?? {}),
    });
  } catch (e) {
    throw netError(what, e);
  }
  return handle<T>(res, what);
}

const itemPath = (id: string) => `/recite/items/${encodeURIComponent(id)}`;

// ── 状态 ────────────────────────────────────────────────────────────────────

export function getOverview(): Promise<ReciteOverview> {
  return getJson<ReciteOverview>('/recite/overview', '取总库状态');
}

export function getItem(id: string): Promise<ReciteItemStatus> {
  return getJson<ReciteItemStatus>(itemPath(id), '取这一条的状态');
}

export function mark(
  id: string,
  action: ReciteMarkAction,
  extra?: { box?: number; days?: number },
): Promise<{ ok: boolean }> {
  return postJson<{ ok: boolean }>(`${itemPath(id)}/mark`, { action, ...(extra ?? {}) }, '标记这一条');
}

export function exposure(id: string, stage: string): Promise<{ ok: boolean; stage: string }> {
  return postJson<{ ok: boolean; stage: string }>(`${itemPath(id)}/exposure`, { stage }, '记曝光轮');
}

export function rescore(
  takeId: string,
  opts: { why_line?: string; mode?: ReciteMode } = {},
): Promise<ReciteScoreResult> {
  return postJson<ReciteScoreResult>(
    `/recite/takes/${encodeURIComponent(takeId)}/rescore`,
    { why_line: opts.why_line ?? '', mode: opts.mode ?? 'read' },
    '评分',
  );
}

// ── 音频 ────────────────────────────────────────────────────────────────────

/**
 * `<audio src>` 带不了 Authorization 头，所以 /media/* 走 ?token=（§3.3 的例外）。
 * 渲染期调用，绝不弹口令输入框 —— 没口令就返回 null，UI 把播放按钮置灰。
 */
export function mediaUrl(slot: 'orig' | 'dialog' | 'take', name: string): string | null {
  if (!base) return null;
  const token = peekToken();
  if (!token) return null;
  return `${base}/media/${slot}/${encodeURIComponent(name)}?token=${encodeURIComponent(token)}`;
}

export const origUrl = (itemId: string) => mediaUrl('orig', `${itemId}.mp3`);
export const dialogUrl = (itemId: string) => mediaUrl('dialog', `${itemId}.mp3`);
export const takeUrl = (takeId: string) => mediaUrl('take', takeId);

// ── 上传 ────────────────────────────────────────────────────────────────────

function encodeMeta(meta: ReciteTakeMeta): string {
  const json = JSON.stringify(meta);
  if (typeof btoa === 'function') {
    // btoa 只吃 latin1；变体题面里有中文，先转成 UTF-8 字节再编。
    const bytes = utf8Bytes(json);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  // Node（selftest / SSR）没有 btoa 的话走 Buffer。
  const g = globalThis as { Buffer?: { from(s: string, enc: string): { toString(enc: string): string } } };
  if (g.Buffer) return g.Buffer.from(json, 'utf-8').toString('base64');
  throw new Error('这个运行环境没有 base64 编码器，元数据发不出去');
}

function utf8Bytes(s: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
  // Hermes 老版本没有 TextEncoder —— 手写一遍，题面里的中文不能烂成问号。
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return Uint8Array.from(out);
}

/**
 * 录完立刻上传（不带评分 → 服务端只存不评）。
 * web 传 Blob，原生传录音文件的 URI —— 用 expo-file-system 的 File 读成字节再发。
 */
export async function uploadTake(
  id: string,
  source: Blob | string,
  meta: ReciteTakeMeta,
  mimeType: string,
): Promise<ReciteUploadResult> {
  const url = `${requireBase()}${itemPath(id)}/take`;
  const token = requireToken();

  let body: Blob | Uint8Array;
  if (typeof source === 'string') {
    if (Platform.OS === 'web') throw new Error('上传失败：web 端应当传 Blob，不是文件路径');
    try {
      const { File } = await import('expo-file-system');
      body = await new File(source).bytes();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`读不到刚才的录音文件（${msg}）—— 录音还在这台设备上`);
    }
  } else {
    body = source;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': mimeType || 'application/octet-stream',
        authorization: `Bearer ${token}`,
        'x-recite-meta': encodeMeta(meta),
      },
      body: body as BodyInit,
    });
  } catch (e) {
    throw netError('上传录音', e);
  }
  return handle<ReciteUploadResult>(res, '上传录音');
}
