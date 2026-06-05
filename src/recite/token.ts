import { Platform } from 'react-native';

/**
 * 口令来源和 src/sync.ts / src/sync.web.ts 完全一致 —— 同一个 ATOM_SYNC_TOKEN 同时给
 * atoms-sync 和 atoms-recite：
 *   · 原生：打包时注入的 EXPO_PUBLIC_ATOM_SYNC_TOKEN；
 *   · web：localStorage 里的 atoms.sync.token，没有就弹一次 window.prompt（口令不进 JS bundle）。
 * 这里不做平台分身文件，是因为分支只有两行，而且 media 的 <audio src> 需要同步拿到口令。
 */

const TOKEN_KEY = 'atoms.sync.token';
const envToken = typeof process !== 'undefined' ? process.env.EXPO_PUBLIC_ATOM_SYNC_TOKEN : undefined;

function browser(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

/** 已经存下来的口令。**不弹窗** —— 渲染期（比如拼 media URL）只能用这个。 */
export function peekToken(): string | null {
  if (browser()) return window.localStorage.getItem(TOKEN_KEY) || envToken || null;
  return envToken || null;
}

/** 要用口令发请求时才调；web 上第一次会弹一次输入框。 */
export function ensureToken(): string | null {
  const stored = peekToken();
  if (stored) return stored;
  if (!browser()) return null;
  const entered = window.prompt('请输入 Atom 同步口令（和卡片同步用同一个）');
  const token = entered?.trim() || null;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  return token;
}

/** 服务端回 401 时清掉，好让下一次重新问一遍。 */
export function clearToken(): void {
  if (browser()) window.localStorage.removeItem(TOKEN_KEY);
}

/** 原生必须有打包进来的口令；web 可以现场问，所以只要有服务地址就算配好了。 */
export function tokenConfigured(): boolean {
  return browser() ? true : Boolean(envToken);
}
