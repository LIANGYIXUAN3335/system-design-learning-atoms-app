import * as SQLite from 'expo-sqlite';
import type { FeedbackRow, FlagKey, FeedbackGrade, Track } from '../types';
import { deserializeFsrs, serializeFsrs } from '../logic/srs';
import type { SrsEntry } from '../logic/queue';

export type Db = SQLite.SQLiteDatabase;

export async function openDb(): Promise<Db> {
  const db = await SQLite.openDatabaseAsync('atoms.db');
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await migrate(db);
  return db;
}

async function migrate(db: Db): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;
  if (version < 1) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS cards (
        id   TEXT PRIMARY KEY,
        ord  INTEGER NOT NULL,
        json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS srs (
        cardId    TEXT PRIMARY KEY,
        fsrs      TEXT NOT NULL,
        due       TEXT NOT NULL,
        state     INTEGER NOT NULL,
        firstSeen TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS review_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        cardId     TEXT NOT NULL,
        ts         TEXT NOT NULL,
        day        TEXT NOT NULL,
        rating     INTEGER NOT NULL,
        wasCorrect INTEGER,
        usedIdk    INTEGER NOT NULL DEFAULT 0,
        elapsedMs  INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_review_log_day ON review_log(day);
      CREATE TABLE IF NOT EXISTS feedback (
        cardId    TEXT PRIMARY KEY,
        grade     TEXT,
        flags     TEXT NOT NULL DEFAULT '[]',
        term      TEXT NOT NULL DEFAULT '',
        note      TEXT NOT NULL DEFAULT '',
        updatedAt TEXT NOT NULL
      );
      PRAGMA user_version = 1;
    `);
  }
  if (version < 2) {
    // M2a (spec §8): settings KV + user-editable tracks.
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tracks (
        id        TEXT PRIMARY KEY,
        name      TEXT NOT NULL,
        include   TEXT NOT NULL,
        exclude   TEXT NOT NULL DEFAULT '[]',
        createdAt TEXT
      );
      PRAGMA user_version = 2;
    `);
  }
  if (version < 3) {
    // Card content now ships read-only in the app bundle (deck.bundle.json) —
    // mirroring all 6k+ cards into SQLite cost thousands of bridge round-trips
    // on EVERY launch for data that never changes at runtime. SQLite keeps only
    // mutable state (srs / review_log / feedback / settings / tracks).
    await db.execAsync(`
      DROP TABLE IF EXISTS cards;
      PRAGMA user_version = 3;
    `);
  }
}

export async function loadSrs(db: Db): Promise<Map<string, SrsEntry>> {
  const rows = await db.getAllAsync<{ cardId: string; fsrs: string; firstSeen: string }>(
    'SELECT cardId, fsrs, firstSeen FROM srs',
  );
  const map = new Map<string, SrsEntry>();
  for (const r of rows) map.set(r.cardId, { fsrs: deserializeFsrs(r.fsrs), firstSeen: r.firstSeen });
  return map;
}

export async function saveSrs(db: Db, cardId: string, entry: SrsEntry): Promise<void> {
  await db.runAsync(
    `INSERT INTO srs (cardId, fsrs, due, state, firstSeen) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(cardId) DO UPDATE SET fsrs = excluded.fsrs, due = excluded.due, state = excluded.state`,
    cardId,
    serializeFsrs(entry.fsrs),
    entry.fsrs.due.toISOString(),
    entry.fsrs.state,
    entry.firstSeen,
  );
}

export interface ReviewLogEntry {
  cardId: string;
  ts: Date;
  day: string;
  rating: number;
  wasCorrect: boolean | null;
  usedIdk: boolean;
  elapsedMs: number;
}

export async function logReview(db: Db, e: ReviewLogEntry): Promise<void> {
  await db.runAsync(
    'INSERT INTO review_log (cardId, ts, day, rating, wasCorrect, usedIdk, elapsedMs) VALUES (?, ?, ?, ?, ?, ?, ?)',
    e.cardId,
    e.ts.toISOString(),
    e.day,
    e.rating,
    e.wasCorrect === null ? null : e.wasCorrect ? 1 : 0,
    e.usedIdk ? 1 : 0,
    e.elapsedMs,
  );
}

export async function countReviewsOnDay(db: Db, day: string): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM review_log WHERE day = ?',
    day,
  );
  return row?.n ?? 0;
}

/** Distinct cards answered on a day — the goal ring's numerator (re-lapses count once). */
export async function distinctCardsOnDay(db: Db, day: string): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ cardId: string }>(
    'SELECT DISTINCT cardId FROM review_log WHERE day = ?',
    day,
  );
  return new Set(rows.map((r) => r.cardId));
}

/** All local days with ≥1 review — the streak's raw material. */
export async function studiedDays(db: Db): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ day: string }>('SELECT DISTINCT day FROM review_log');
  return new Set(rows.map((r) => r.day));
}

// ---- settings KV -------------------------------------------------------

export async function loadSettingsKv(db: Db): Promise<Map<string, string>> {
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings');
  return new Map(rows.map((r) => [r.key, r.value]));
}

export async function saveSettingsKv(db: Db, kv: Map<string, string>): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const [key, value] of kv.entries()) {
      await db.runAsync(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        key,
        value,
      );
    }
  });
}

// ---- tracks -------------------------------------------------------------

/**
 * Seed tracks exactly once, then apply one-shot seed migrations for built-in
 * tracks added after a user already has a local DB. The migration key keeps
 * user deletions sticky after the new built-in track has been offered once.
 */
export async function seedTracksOnce(db: Db, seeds: Track[]): Promise<void> {
  const done = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'tracksSeeded'",
  );
  if (done?.value !== '1') {
    await db.withTransactionAsync(async () => {
      for (const t of seeds) {
        await db.runAsync(
          'INSERT OR IGNORE INTO tracks (id, name, include, exclude, createdAt) VALUES (?, ?, ?, ?, ?)',
          t.id,
          t.name,
          JSON.stringify(t.include),
          JSON.stringify(t.exclude ?? []),
          new Date().toISOString(),
        );
      }
      await db.runAsync(
        "INSERT INTO settings (key, value) VALUES ('tracksSeeded', '1') ON CONFLICT(key) DO UPDATE SET value = '1'",
      );
    });
  }

  const seedVersion = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'trackSeedVersion'",
  );
  const currentVersion = Number(seedVersion?.value ?? '0');
  if (currentVersion < 1) {
    const lld = seeds.find((t) => t.id === 'low-level-design');
    if (lld) {
      await db.runAsync(
        'INSERT OR IGNORE INTO tracks (id, name, include, exclude, createdAt) VALUES (?, ?, ?, ?, ?)',
        lld.id,
        lld.name,
        JSON.stringify(lld.include),
        JSON.stringify(lld.exclude ?? []),
        new Date().toISOString(),
      );
    }
    await db.runAsync(
      "INSERT INTO settings (key, value) VALUES ('trackSeedVersion', '1') ON CONFLICT(key) DO UPDATE SET value = '1'",
    );
  }

  if (currentVersion < 2) {
    const review = seeds.find((t) => t.id === 'interview-review');
    if (review) {
      await db.runAsync(
        'INSERT OR IGNORE INTO tracks (id, name, include, exclude, createdAt) VALUES (?, ?, ?, ?, ?)',
        review.id,
        review.name,
        JSON.stringify(review.include),
        JSON.stringify(review.exclude ?? []),
        new Date().toISOString(),
      );
    }
    await db.runAsync(
      "INSERT INTO settings (key, value) VALUES ('trackSeedVersion', '2') ON CONFLICT(key) DO UPDATE SET value = '2'",
    );
  }
}

export async function loadTracks(db: Db): Promise<Track[]> {
  const rows = await db.getAllAsync<{ id: string; name: string; include: string; exclude: string }>(
    'SELECT id, name, include, exclude FROM tracks ORDER BY createdAt',
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    include: JSON.parse(r.include) as string[],
    exclude: JSON.parse(r.exclude) as string[],
  }));
}

export async function saveTrack(db: Db, t: Track): Promise<void> {
  await db.runAsync(
    `INSERT INTO tracks (id, name, include, exclude, createdAt) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, include = excluded.include, exclude = excluded.exclude`,
    t.id,
    t.name,
    JSON.stringify(t.include),
    JSON.stringify(t.exclude ?? []),
    new Date().toISOString(),
  );
}

export async function deleteTrack(db: Db, id: string): Promise<void> {
  await db.runAsync('DELETE FROM tracks WHERE id = ?', id);
}

export async function loadFeedback(db: Db): Promise<Map<string, FeedbackRow>> {
  const rows = await db.getAllAsync<{
    cardId: string;
    grade: string | null;
    flags: string;
    term: string;
    note: string;
    updatedAt: string;
  }>('SELECT * FROM feedback');
  const map = new Map<string, FeedbackRow>();
  for (const r of rows) {
    map.set(r.cardId, {
      cardId: r.cardId,
      grade: (r.grade as FeedbackGrade | null) ?? null,
      flags: JSON.parse(r.flags) as FlagKey[],
      term: r.term,
      note: r.note,
      updatedAt: r.updatedAt,
    });
  }
  return map;
}

export async function saveFeedback(db: Db, row: FeedbackRow): Promise<void> {
  await db.runAsync(
    `INSERT INTO feedback (cardId, grade, flags, term, note, updatedAt) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(cardId) DO UPDATE SET
       grade = excluded.grade, flags = excluded.flags, term = excluded.term,
       note = excluded.note, updatedAt = excluded.updatedAt`,
    row.cardId,
    row.grade,
    JSON.stringify(row.flags),
    row.term,
    row.note,
    row.updatedAt,
  );
}
