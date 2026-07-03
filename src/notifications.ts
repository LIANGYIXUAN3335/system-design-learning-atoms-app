import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { RHYTHMS } from './config';
import type { AppSettings } from './types';

/**
 * Reminders (spec §5): notifications only — FSRS stays the sole scheduler.
 *
 * There is no native "every other day" repeating trigger, so all rhythms use
 * one mechanism: explicit DATE triggers for the next 7 days, wiped and
 * rescheduled on every app launch and settings change (atoms-m2a-review.md
 * §2.7). ≤14 pending notifications, far under iOS's 64 cap. Self-healing as
 * long as the app is opened within a week.
 *
 * Local notifications work in Expo Go on iOS (SDK 57 docs); web is not
 * supported — every entry point no-ops there so the web demo can't crash.
 */

export type ReminderStatus = 'scheduled' | 'disabled' | 'denied' | 'unsupported';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

function at(dayOffset: number, hhmm: string, now: Date): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, h, m, 0);
  return d;
}

export async function rescheduleReminders(
  settings: AppSettings,
  now: Date = new Date(),
): Promise<ReminderStatus> {
  if (Platform.OS === 'web') return 'unsupported';

  await Notifications.cancelAllScheduledNotificationsAsync();
  if (!settings.remindersEnabled) return 'disabled';

  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) {
    const req = await Notifications.requestPermissionsAsync();
    if (!req.granted) return 'denied';
  }

  const preset = RHYTHMS[settings.rhythm];
  const slots: Date[] = [];
  for (const offset of preset.reminderDayOffsets) {
    slots.push(at(offset, settings.morningTime, now));
    if (preset.eveningReminder) slots.push(at(offset, settings.eveningTime, now));
  }

  for (const date of slots) {
    if (date.getTime() <= now.getTime()) continue;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Atoms · 该刷题了',
        body: '清空今天的队列，保住 🔥 连续天数',
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
    });
  }
  return 'scheduled';
}
