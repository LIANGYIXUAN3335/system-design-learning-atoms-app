import { DEFAULT_EVENING, DEFAULT_MORNING } from '../config';
import type { AppSettings, RhythmId } from '../types';

export const DEFAULT_SETTINGS: AppSettings = {
  targetDate: null,
  activeTrackId: 'all',
  activeCategory: 'all',
  rhythm: 'normal',
  remindersEnabled: false,
  morningTime: DEFAULT_MORNING,
  eveningTime: DEFAULT_EVENING,
};

const RHYTHM_IDS: RhythmId[] = ['intensive', 'normal', 'relaxed'];

export function isValidDateStr(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function isValidTimeStr(s: string): boolean {
  if (!/^\d{1,2}:\d{2}$/.test(s)) return false;
  const [h, m] = s.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

/** Rebuild typed settings from the KV rows, discarding anything malformed. */
export function settingsFromKv(kv: Map<string, string>): AppSettings {
  const s: AppSettings = { ...DEFAULT_SETTINGS };
  const target = kv.get('targetDate');
  if (target && isValidDateStr(target)) s.targetDate = target;
  const track = kv.get('activeTrackId');
  if (track) s.activeTrackId = track;
  const category = kv.get('activeCategory');
  if (category) s.activeCategory = category;
  const rhythm = kv.get('rhythm') as RhythmId | undefined;
  if (rhythm && RHYTHM_IDS.includes(rhythm)) s.rhythm = rhythm;
  s.remindersEnabled = kv.get('remindersEnabled') === '1';
  const morning = kv.get('morningTime');
  if (morning && isValidTimeStr(morning)) s.morningTime = morning;
  const evening = kv.get('eveningTime');
  if (evening && isValidTimeStr(evening)) s.eveningTime = evening;
  return s;
}

export function settingsToKv(s: AppSettings): Map<string, string> {
  return new Map<string, string>([
    ['targetDate', s.targetDate ?? ''],
    ['activeTrackId', s.activeTrackId],
    ['activeCategory', s.activeCategory],
    ['rhythm', s.rhythm],
    ['remindersEnabled', s.remindersEnabled ? '1' : '0'],
    ['morningTime', s.morningTime],
    ['eveningTime', s.eveningTime],
  ]);
}
