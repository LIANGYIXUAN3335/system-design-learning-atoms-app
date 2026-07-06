// Tunables — M1 decisions in atoms-m1-review.md §6, M2a in atoms-m2a-review.md §5.

import type { RhythmId } from './types';

/** Fallback new-cards/day when no interview date is set (planner overrides when it is). */
export const NEW_PER_DAY = 100;

/**
 * Recommended new-cards/day — deliberately tied to the fallback pace: exceeding
 * the default rhythm is exactly what the "冲刺" warning should flag. Change
 * NEW_PER_DAY and this threshold follows.
 */
export const RECOMMENDED_NEW_PER_DAY = NEW_PER_DAY;

/** "Mastered" proxy: Review state with stability ≥ this many days (M1 definition, now shared). */
export const MASTERED_STABILITY_DAYS = 7;

/**
 * Final-stretch window (M3 §3.2 Phase 3): within this many days of the interview,
 * stop introducing new cards and drill the not-yet-mastered "weak set" instead —
 * by then the deck has been seen once, so the job is shoring up gaps, not breadth.
 */
export const FINAL_STRETCH_DAYS = 3;

/** Anki-style learn-ahead: learning/relearning cards due within this window are served now. */
export const LEARN_AHEAD_MIN = 20;

/** expo-speech rate for the English restatement (prototype used 0.95). */
export const TTS_RATE = 0.95;
export const TTS_LANGUAGE = 'en-US';

/**
 * Study rhythms (spec §5): ONE user choice bundling reminder cadence and FSRS
 * request_retention. FSRS remains the only scheduler — retention is an input
 * knob, reminders are notifications, neither creates a second queue.
 */
export interface RhythmPreset {
  id: RhythmId;
  label: string;
  description: string;
  requestRetention: number;
  /** reminders per day pattern: which upcoming day-offsets get reminders */
  reminderDayOffsets: number[];
  /** whether the evening reminder is also scheduled */
  eveningReminder: boolean;
}

export const RHYTHMS: Record<RhythmId, RhythmPreset> = {
  intensive: {
    id: 'intensive',
    label: '早晚刷（冲刺）',
    description: '早晚各提醒一次 · 卡片回归最勤 (retention 0.95)',
    requestRetention: 0.95,
    reminderDayOffsets: [0, 1, 2, 3, 4, 5, 6],
    eveningReminder: true,
  },
  normal: {
    id: 'normal',
    label: '每天刷（正常）',
    description: '每天提醒一次 · 平衡负担 (retention 0.90，默认)',
    requestRetention: 0.9,
    reminderDayOffsets: [0, 1, 2, 3, 4, 5, 6],
    eveningReminder: false,
  },
  relaxed: {
    id: 'relaxed',
    label: '隔天刷（轻松）',
    description: '隔天提醒 · 间隔最宽、总时间最少 (retention 0.85)',
    requestRetention: 0.85,
    reminderDayOffsets: [1, 3, 5],
    eveningReminder: false,
  },
};

export const DEFAULT_MORNING = '09:00';
export const DEFAULT_EVENING = '21:00';
