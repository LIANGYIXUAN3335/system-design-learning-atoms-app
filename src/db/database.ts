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

  if (currentVersion < 3) {
    const interviewEnglish = seeds.find((t) => t.id === 'interview-english');
    if (interviewEnglish) {
      await db.runAsync(
        'INSERT OR IGNORE INTO tracks (id, name, include, exclude, createdAt) VALUES (?, ?, ?, ?, ?)',
        interviewEnglish.id,
        interviewEnglish.name,
        JSON.stringify(interviewEnglish.include),
        JSON.stringify(interviewEnglish.exclude ?? []),
        new Date().toISOString(),
      );
    }
    await db.runAsync(
      "INSERT INTO settings (key, value) VALUES ('trackSeedVersion', '3') ON CONFLICT(key) DO UPDATE SET value = '3'",
    );
  }

  // v4: built-in tracks added after v3 — cli (2026-07-31; its migration was
  // forgotten at the time, so existing installs never saw it) and pmle (2026-08-03).
  if (currentVersion < 4) {
    for (const id of ['cli', 'pmle']) {
      const t = seeds.find((s) => s.id === id);
      if (!t) continue;
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
      "INSERT INTO settings (key, value) VALUES ('trackSeedVersion', '4') ON CONFLICT(key) DO UPDATE SET value = '4'",
    );
  }

  // v5: user decision 2026-08-04 — fold 面试临场 into 面试复盘 as one learner-facing
  // track; the track:interview-drill tag lives on inside interview-review's include.
  // UPDATE (not upsert) keeps a user's deletion of interview-review sticky.
  if (currentVersion < 5) {
    const review = seeds.find((s) => s.id === 'interview-review');
    if (review) {
      await db.runAsync(
        'UPDATE tracks SET include = ? WHERE id = ?',
        JSON.stringify(review.include),
        review.id,
      );
    }
    await db.runAsync("DELETE FROM tracks WHERE id = 'interview-drill'");
    await db.runAsync(
      "INSERT INTO settings (key, value) VALUES ('trackSeedVersion', '5') ON CONFLICT(key) DO UPDATE SET value = '5'",
    );
  }

  // v6: labuladong 四板块 tracks added 2026-08-21 (编程语言基础 / 算法教程 /
  // Agent 开发 / 全栈开发) — same INSERT OR IGNORE pattern as v4 so existing
  // installs pick them up.
  if (currentVersion < 6) {
    for (const id of ['lbld-lang', 'lbld-algo', 'lbld-agent', 'lbld-fullstack']) {
      const t = seeds.find((s) => s.id === id);
      if (!t) continue;
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
      "INSERT INTO settings (key, value) VALUES ('trackSeedVersion', '6') ON CONFLICT(key) DO UPDATE SET value = '6'",
    );
  }

  // v7: user decision 2026-08-21 — regroup by 用途 into two big tracks:
  // interview-review absorbs interview-english and is renamed 面试实战;
  // new coding-fundamentals absorbs cli + the four lbld-* tracks.
  // UPDATE (not upsert) keeps a user's deletion of interview-review sticky,
  // mirroring the v5 merge.
  if (currentVersion < 7) {
    const review = seeds.find((s) => s.id === 'interview-review');
    if (review) {
      await db.runAsync(
        'UPDATE tracks SET name = ?, include = ? WHERE id = ?',
        review.name,
        JSON.stringify(review.include),
        review.id,
      );
    }
    const fundamentals = seeds.find((s) => s.id === 'coding-fundamentals');
    if (fundamentals) {
      await db.runAsync(
        'INSERT OR IGNORE INTO tracks (id, name, include, exclude, createdAt) VALUES (?, ?, ?, ?, ?)',
        fundamentals.id,
        fundamentals.name,
        JSON.stringify(fundamentals.include),
        JSON.stringify(fundamentals.exclude ?? []),
        new Date().toISOString(),
      );
    }
    await db.runAsync(
      "DELETE FROM tracks WHERE id IN ('interview-english', 'cli', 'lbld-lang', 'lbld-algo', 'lbld-agent', 'lbld-fullstack')",
    );
    await db.runAsync(
      "INSERT INTO settings (key, value) VALUES ('trackSeedVersion', '7') ON CONFLICT(key) DO UPDATE SET value = '7'",
    );
  }

  // v8: 做局思维 (power-scheming) track added 2026-08-22 — same INSERT OR IGNORE
  // pattern as v4/v6 so existing installs (tracksSeeded already '1') pick it up.
  if (currentVersion < 8) {
    const t = seeds.find((s) => s.id === 'power-scheming');
    if (t) {
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
      "INSERT INTO settings (key, value) VALUES ('trackSeedVersion', '8') ON CONFLICT(key) DO UPDATE SET value = '8'",
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
