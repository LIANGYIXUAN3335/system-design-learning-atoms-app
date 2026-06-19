import type { Db, SyncSnapshot } from './db/database';
import { exportSyncSnapshot, mergeSyncSnapshot } from './db/database';

const endpoint = typeof process !== 'undefined' ? process.env.EXPO_PUBLIC_ATOM_SYNC_URL : undefined;
const token = typeof process !== 'undefined' ? process.env.EXPO_PUBLIC_ATOM_SYNC_TOKEN : undefined;

export function syncConfigured(): boolean {
  return Boolean(endpoint && token);
}

/** Local-first sync: upload local state, let the server merge, then pull its canonical snapshot. */
export async function syncNow(db: Db): Promise<SyncSnapshot | null> {
  if (!endpoint || !token) return null;
  const local = await exportSyncSnapshot(db);
  const response = await fetch(`${endpoint.replace(/\/$/, '')}/sync`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(local),
  });
  if (!response.ok) throw new Error(`Sync failed (${response.status})`);
  const merged = (await response.json()) as SyncSnapshot;
  await mergeSyncSnapshot(db, merged);
  return merged;
}
