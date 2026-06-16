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
  if (version < 4) {
    // Sync metadata: SRS is last-write-wins per card; reviews are append-only.
    await db.execAsync(`
      ALTER TABLE srs ADD COLUMN updatedAt TEXT NOT NULL DEFAULT '';
      UPDATE srs SET updatedAt = firstSeen WHERE updatedAt = '';
      ALTER TABLE review_log ADD COLUMN eventId TEXT;
      UPDATE review_log SET eventId = 'legacy-' || id WHERE eventId IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_review_log_event_id ON review_log(eventId);
      PRAGMA user_version = 4;
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
     `INSERT INTO srs (cardId, fsrs, due, state, firstSeen, updatedAt) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(cardId) DO UPDATE SET fsrs = excluded.fsrs, due = excluded.due,
       state = excluded.state, updatedAt = excluded.updatedAt`,
    cardId,
    serializeFsrs(entry.fsrs),
    entry.fsrs.due.toISOString(),
    entry.fsrs.state,
    entry.firstSeen,
    new Date().toISOString(),
  );
}

export interface ReviewLogEntry {
  eventId?: string;
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
    'INSERT OR IGNORE INTO review_log (eventId, cardId, ts, day, rating, wasCorrect, usedIdk, elapsedMs) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    e.eventId ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    e.cardId,
    e.ts.toISOString(),
    e.day,
    e.rating,
    e.wasCorrect === null ? null : e.wasCorrect ? 1 : 0,
    e.usedIdk ? 1 : 0,
    e.elapsedMs,
  );
}

export interface SyncSnapshot {
  srs: Array<{ cardId: string; fsrs: string; due: string; state: number; firstSeen: string; updatedAt: string }>;
  reviews: Array<ReviewLogEntry & { eventId: string }>;
  feedback: FeedbackRow[];
}

/** Export only mutable learning state. Card content remains in the app bundle. */
export async function exportSyncSnapshot(db: Db): Promise<SyncSnapshot> {
  const srs = await db.getAllAsync<SyncSnapshot['srs'][number]>(
    'SELECT cardId, fsrs, due, state, firstSeen, updatedAt FROM srs',
  );
  const reviewRows = await db.getAllAsync<{
    eventId: string; cardId: string; ts: string; day: string; rating: number;
    wasCorrect: number | null; usedIdk: number; elapsedMs: number;
  }>('SELECT eventId, cardId, ts, day, rating, wasCorrect, usedIdk, elapsedMs FROM review_log');
  const feedback = [...(await loadFeedback(db)).values()];
  return {
    srs,
    reviews: reviewRows.map((r) => ({
      eventId: r.eventId,
      cardId: r.cardId,
      ts: new Date(r.ts),
      day: r.day,
      rating: r.rating,
      wasCorrect: r.wasCorrect == null ? null : r.wasCorrect === 1,
      usedIdk: r.usedIdk === 1,
      elapsedMs: r.elapsedMs,
    })),
    feedback,
  };
}

/** Merge the server's canonical snapshot into local SQLite without deleting local data. */
export async function mergeSyncSnapshot(db: Db, snapshot: SyncSnapshot): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const row of snapshot.srs) {
      await db.runAsync(
        `INSERT INTO srs (cardId, fsrs, due, state, firstSeen, updatedAt) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(cardId) DO UPDATE SET fsrs = excluded.fsrs, due = excluded.due,
           state = excluded.state, firstSeen = excluded.firstSeen, updatedAt = excluded.updatedAt
         WHERE excluded.updatedAt >= srs.updatedAt`,
        row.cardId, row.fsrs, row.due, row.state, row.firstSeen, row.updatedAt,
      );
    }
    for (const e of snapshot.reviews) {
      await db.runAsync(
        `INSERT OR IGNORE INTO review_log (eventId, cardId, ts, day, rating, wasCorrect, usedIdk, elapsedMs)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        e.eventId, e.cardId, new Date(e.ts).toISOString(), e.day, e.rating,
        e.wasCorrect == null ? null : e.wasCorrect ? 1 : 0, e.usedIdk ? 1 : 0, e.elapsedMs,
      );
    }
    for (const row of snapshot.feedback) {
      await db.runAsync(
        `INSERT INTO feedback (cardId, grade, flags, term, note, updatedAt) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(cardId) DO UPDATE SET grade = excluded.grade, flags = excluded.flags,
           term = excluded.term, note = excluded.note, updatedAt = excluded.updatedAt
         WHERE excluded.updatedAt >= feedback.updatedAt`,
        row.cardId, row.grade, JSON.stringify(row.flags), row.term, row.note, row.updatedAt,
      );
    }
  });
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

/** A1：所有有用时的作答记录（cardId + elapsedMs），启动时算一次各卡型中位数。 */
export async function loadElapsedSamples(db: Db): Promise<Array<{ cardId: string; elapsedMs: number }>> {
  return db.getAllAsync<{ cardId: string; elapsedMs: number }>(
    'SELECT cardId, elapsedMs FROM review_log WHERE elapsedMs > 0',
  );
}

/**
 * B4 / A3：某一天做了几张（去重）、一共投入多少毫秒。
 * 单张卡最多算 capMs（防止把手机放一边的时间算成「坚持」）。
 */
export async function dayActivity(db: Db, day: string, capMs: number): Promise<{ cards: number; ms: number }> {
  const row = await db.getFirstAsync<{ cards: number; ms: number | null }>(
    'SELECT COUNT(DISTINCT cardId) AS cards, SUM(MIN(elapsedMs, ?)) AS ms FROM review_log WHERE day = ?',
    capMs,
    day,
  );
  return { cards: row?.cards ?? 0, ms: row?.ms ?? 0 };
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

  // v9: ordered first-pass system-design route. These are deliberately small
  // curated slices of the classic deck: framework → patterns → components →
  // representative systems → senior follow-ups.
  if (currentVersion < 9) {
    for (const id of [
      'sd-path-00-framework',
      'sd-path-01-patterns',
      'sd-path-02-components',
      'sd-path-03-cases',
      'sd-path-04-upgrades',
    ]) {
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
      "INSERT INTO settings (key, value) VALUES ('trackSeedVersion', '9') ON CONFLICT(key) DO UPDATE SET value = '9'",
    );
  }

  // v10: the first-pass route is an on-ramp, not a false promise that 328
  // cards cover the whole classic deck. Add the existing tag-based deep-dive
  // tracks and the remaining-card gap-fill track for existing installations.
  if (currentVersion < 10) {
    for (const id of [
      'sd-path-10-foundations',
      'sd-path-11-patterns-full',
      'sd-path-12-data-storage',
      'sd-path-13-platform-network',
      'sd-path-14-product-systems',
      'sd-path-15-reference',
      'sd-path-99-gap-fill',
    ]) {
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
      "INSERT INTO settings (key, value) VALUES ('trackSeedVersion', '10') ON CONFLICT(key) DO UPDATE SET value = '10'",
    );
  }

  // v11: the system-design curriculum belongs inside the one existing
  // "经典系统设计" track. Retire the temporary top-level route tracks without
  // touching any FSRS rows, and preserve the learner's current place when one
  // of those route tracks had been selected.
  if (currentVersion < 11) {
    const legacyToRoadmap: Record<string, string> = {
      'sd-path-00-framework': 'sd-00-framework',
      'sd-path-01-patterns': 'sd-01-patterns',
      'sd-path-02-components': 'sd-02-components',
      'sd-path-03-cases': 'sd-03-cases',
      'sd-path-04-upgrades': 'sd-04-upgrades',
      'sd-path-10-foundations': 'sd-10-foundations',
      'sd-path-11-patterns-full': 'sd-11-patterns-full',
      'sd-path-12-data-storage': 'sd-12-data-storage',
      'sd-path-13-platform-network': 'sd-13-platform-network',
      'sd-path-14-product-systems': 'sd-14-product-systems',
      'sd-path-15-reference': 'sd-15-reference',
      'sd-path-99-gap-fill': 'sd-99-gap-fill',
    };
    const active = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'activeTrackId'",
    );
    const mappedStage = active?.value ? legacyToRoadmap[active.value] : undefined;
    if (mappedStage) {
      await db.runAsync("UPDATE settings SET value = 'classic-sd' WHERE key = 'activeTrackId'");
      await db.runAsync(
        "INSERT INTO settings (key, value) VALUES ('activeRoadmapStage', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        mappedStage,
      );
    }
    await db.runAsync(
      "DELETE FROM tracks WHERE id IN ('sd-path-00-framework', 'sd-path-01-patterns', 'sd-path-02-components', 'sd-path-03-cases', 'sd-path-04-upgrades', 'sd-path-10-foundations', 'sd-path-11-patterns-full', 'sd-path-12-data-storage', 'sd-path-13-platform-network', 'sd-path-14-product-systems', 'sd-path-15-reference', 'sd-path-99-gap-fill')",
    );
    await db.runAsync(
      "INSERT INTO settings (key, value) VALUES ('trackSeedVersion', '11') ON CONFLICT(key) DO UPDATE SET value = '11'",
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
