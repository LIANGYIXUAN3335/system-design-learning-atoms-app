import http from 'node:http';
import { Firestore } from '@google-cloud/firestore';

const db = new Firestore();
const port = Number(process.env.PORT || 8080);
const token = process.env.ATOM_SYNC_TOKEN;
const shardCollection = db.collection('atoms').doc('private-progress').collection('shards');
const SHARD_COUNT = 32;
const SHARD_KINDS = ['srs', 'reviews', 'feedback', 'userCards', 'hiddenCards'];

function json(res, status, body) {
  // CORS：浏览器发带 Authorization 的 POST 前先 OPTIONS 预检，预检必须明说允许哪些方法和头，
  // 否则浏览器把 POST 拦在本地（2026-10-14 查实：云端只见 OPTIONS 204、从没见过 POST，所以一直 0 条）。
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
  });
  res.end(JSON.stringify(body));
}

function validSnapshot(value) {
  return value &&
    Array.isArray(value.srs) &&
    Array.isArray(value.reviews) &&
    Array.isArray(value.feedback) &&
    (value.userCards === undefined || Array.isArray(value.userCards)) &&
    (value.hiddenCards === undefined || Array.isArray(value.hiddenCards));
}

function normalizedSnapshot(snapshot) {
  return { ...snapshot, userCards: snapshot.userCards || [], hiddenCards: snapshot.hiddenCards || [] };
}

function shardFor(kind, key) {
  let hash = 2166136261;
  for (const char of `${kind}:${key}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % SHARD_COUNT;
}

function merge(current, incoming) {
  const srs = new Map((current?.srs || []).map((x) => [x.cardId, x]));
  for (const row of incoming.srs) {
    const old = srs.get(row.cardId);
    if (!old || String(row.updatedAt) >= String(old.updatedAt)) srs.set(row.cardId, row);
  }
  const reviews = new Map((current?.reviews || []).map((x) => [x.eventId, x]));
  for (const row of incoming.reviews) reviews.set(row.eventId, row);
  const feedback = new Map((current?.feedback || []).map((x) => [x.cardId, x]));
  for (const row of incoming.feedback) {
    const old = feedback.get(row.cardId);
    if (!old || String(row.updatedAt) >= String(old.updatedAt)) feedback.set(row.cardId, row);
  }
  const userCards = new Map((current?.userCards || []).map((x) => [x.id, x]));
  for (const row of incoming.userCards) {
    const old = userCards.get(row.id);
    if (!old || String(row.updatedAt) >= String(old.updatedAt)) userCards.set(row.id, row);
  }
  const hiddenCards = new Map((current?.hiddenCards || []).map((x) => [x.cardId, x]));
  for (const row of incoming.hiddenCards) {
    const old = hiddenCards.get(row.cardId);
    if (!old || String(row.updatedAt) >= String(old.updatedAt)) hiddenCards.set(row.cardId, row);
  }
  return {
    srs: [...srs.values()],
    reviews: [...reviews.values()],
    feedback: [...feedback.values()],
    userCards: [...userCards.values()],
    hiddenCards: [...hiddenCards.values()],
  };
}

function emptyShard() {
  return { srs: [], reviews: [], feedback: [], userCards: [], hiddenCards: [] };
}

function recordsForShard(snapshot, shard) {
  return {
    srs: snapshot.srs.filter((x) => shardFor('srs', x.cardId) === shard),
    reviews: snapshot.reviews.filter((x) => shardFor('reviews', x.eventId) === shard),
    feedback: snapshot.feedback.filter((x) => shardFor('feedback', x.cardId) === shard),
    userCards: snapshot.userCards.filter((x) => shardFor('userCards', x.id) === shard),
    hiddenCards: snapshot.hiddenCards.filter((x) => shardFor('hiddenCards', x.cardId) === shard),
  };
}

async function loadShards() {
  const refs = Array.from({ length: SHARD_COUNT * SHARD_KINDS.length }, (_, index) => {
    const kind = SHARD_KINDS[Math.floor(index / SHARD_COUNT)];
    const shard = index % SHARD_COUNT;
    return shardCollection.doc(`${kind}-${shard}`);
  });
  const docs = await db.getAll(...refs);
  const current = Array.from({ length: SHARD_COUNT }, emptyShard);
  for (const doc of docs) {
    const data = doc.data() || emptyShard();
    const dash = doc.id.lastIndexOf('-');
    const kind = doc.id.slice(0, dash);
    const shard = Number(doc.id.slice(dash + 1));
    if (SHARD_KINDS.includes(kind)) current[shard][kind] = Array.isArray(data[kind]) ? data[kind] : [];
  }
  return current;
}

function combine(shards) {
  return {
    srs: shards.flatMap((x) => x.srs),
    reviews: shards.flatMap((x) => x.reviews),
    feedback: shards.flatMap((x) => x.feedback),
    userCards: shards.flatMap((x) => x.userCards),
    hiddenCards: shards.flatMap((x) => x.hiddenCards),
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'POST' || req.url !== '/sync') return json(res, 404, { error: 'not found' });
  if (!token || req.headers.authorization !== `Bearer ${token}`) return json(res, 401, { error: 'unauthorized' });
  try {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const parsed = JSON.parse(raw);
    if (!validSnapshot(parsed)) return json(res, 400, { error: 'invalid snapshot' });
    const incoming = normalizedSnapshot(parsed);
    const currentShards = await loadShards();
    const incomingShards = Array.from({ length: SHARD_COUNT }, (_, shard) => recordsForShard(incoming, shard));
    const mergedShards = currentShards.map((current, shard) => merge(current, incomingShards[shard]));
    const batch = db.batch();
    for (let shard = 0; shard < SHARD_COUNT; shard++) {
      for (const kind of SHARD_KINDS) {
        batch.set(shardCollection.doc(`${kind}-${shard}`), { [kind]: mergedShards[shard][kind] }, { merge: true });
      }
    }
    await batch.commit();
    return json(res, 200, combine(mergedShards));
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: 'sync failed' });
  }
});
server.listen(port, () => console.log(`Atoms sync listening on ${port}`));
