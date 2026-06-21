import type { Db, SyncSnapshot } from './db/database';
import { exportSyncSnapshot, mergeSyncSnapshot } from './db/database';

const endpoint = typeof process !== 'undefined' ? process.env.EXPO_PUBLIC_ATOM_SYNC_URL : undefined;
/** 部署脚本打包时注入的口令（deploy-gcp.sh 从 Cloud Run 现取）。有它就不再弹窗问。 */
const envToken = typeof process !== 'undefined' ? process.env.EXPO_PUBLIC_ATOM_SYNC_TOKEN : undefined;
const TOKEN_KEY = 'atoms.sync.token';

function getBrowserToken(): string | null {
  if (typeof window === 'undefined') return null;
  const existing = window.localStorage.getItem(TOKEN_KEY);
  if (existing) return existing;
  if (envToken) return envToken;
  const entered = window.prompt('请输入 Atom 同步口令');
  const token = entered?.trim() || null;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  return token;
}

export function syncConfigured(): boolean {
  return Boolean(endpoint);
}

/** Web sync keeps the bearer token out of the public JavaScript bundle. */
export async function syncNow(db: Db): Promise<SyncSnapshot | null> {
  if (!endpoint) return null;
  const token = getBrowserToken();
  if (!token) return null;
  const local = await exportSyncSnapshot(db);
  const response = await fetch(`${endpoint.replace(/\/$/, '')}/sync`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(local),
  });
  if (response.status === 401) {
    window.localStorage.removeItem(TOKEN_KEY);
    throw new Error(envToken && token === envToken ? '打包进来的同步口令已失效，要重新部署网页版' : '同步口令不正确');
  }
  if (!response.ok) throw new Error(`Sync failed (${response.status})`);
  const merged = (await response.json()) as SyncSnapshot;
  await mergeSyncSnapshot(db, merged);
  return merged;
}
