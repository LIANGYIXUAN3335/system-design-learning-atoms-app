import http from 'node:http';
import { Firestore } from '@google-cloud/firestore';

const db = new Firestore();
const port = Number(process.env.PORT || 8080);
const token = process.env.ATOM_SYNC_TOKEN;
const shardCollection = db.collection('atoms').doc('private-progress').collection('shards');
const SHARD_COUNT = 32;

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
}

function validSnapshot(value) {
  return value && Array.isArray(value.srs) && Array.isArray(value.reviews) && Array.isArray(value.feedback);
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
  return { srs: [...srs.values()], reviews: [...reviews.values()], feedback: [...feedback.values()] };
}

function emptyShard() {
  return { srs: [], reviews: [], feedback: [] };
}

function recordsForShard(snapshot, shard) {
  return {
    srs: snapshot.srs.filter((x) => shardFor('srs', x.cardId) === shard),
    reviews: snapshot.reviews.filter((x) => shardFor('reviews', x.eventId) === shard),
    feedback: snapshot.feedback.filter((x) => shardFor('feedback', x.cardId) === shard),
  };
}

async function loadShards() {
  const refs = Array.from({ length: SHARD_COUNT * 3 }, (_, index) => {
    const kind = ['srs', 'reviews', 'feedback'][Math.floor(index / SHARD_COUNT)];
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
    if (kind === 'srs') current[shard].srs = data.srs || [];
    if (kind === 'reviews') current[shard].reviews = data.reviews || [];
    if (kind === 'feedback') current[shard].feedback = data.feedback || [];
  }
  return current;
}

function combine(shards) {
  return {
    srs: shards.flatMap((x) => x.srs),
    reviews: shards.flatMap((x) => x.reviews),
    feedback: shards.flatMap((x) => x.feedback),
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'POST' || req.url !== '/sync') return json(res, 404, { error: 'not found' });
  if (!token || req.headers.authorization !== `Bearer ${token}`) return json(res, 401, { error: 'unauthorized' });
  try {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const incoming = JSON.parse(raw);
    if (!validSnapshot(incoming)) return json(res, 400, { error: 'invalid snapshot' });
    const currentShards = await loadShards();
    const incomingShards = Array.from({ length: SHARD_COUNT }, (_, shard) => recordsForShard(incoming, shard));
    const mergedShards = currentShards.map((current, shard) => merge(current, incomingShards[shard]));
    const batch = db.batch();
    for (let shard = 0; shard < SHARD_COUNT; shard++) {
      batch.set(shardCollection.doc(`srs-${shard}`), { srs: mergedShards[shard].srs }, { merge: true });
      batch.set(shardCollection.doc(`reviews-${shard}`), { reviews: mergedShards[shard].reviews }, { merge: true });
      batch.set(shardCollection.doc(`feedback-${shard}`), { feedback: mergedShards[shard].feedback }, { merge: true });
    }
    await batch.commit();
    return json(res, 200, combine(mergedShards));
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: 'sync failed' });
  }
});
server.listen(port, () => console.log(`Atoms sync listening on ${port}`));
