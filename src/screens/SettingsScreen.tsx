import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { RHYTHMS } from '../config';
import { addLocalDays, daysBetweenLocal, localDateStr } from '../logic/dates';
import { isValidDateStr, isValidTimeStr } from '../logic/settings';
import { trackIdFromName } from '../logic/tracks';
import { useTheme } from '../theme';
import type { AppSettings, RhythmId, Track } from '../types';
import { ActButton, GhostButton } from '../components/ui';

const PREP_DAY_MIN = 1;
const PREP_DAY_MAX = 60;
const PREP_DAY_PRESETS = [7, 14, 30, 45, 60];
const PREP_DAY_DEFAULT = 30;

function clampPrepDays(days: number): number {
  return Math.max(PREP_DAY_MIN, Math.min(PREP_DAY_MAX, days));
}

/** same local-day math as the planner (shared via dates.ts), null when unset/invalid */
function daysUntilLocal(targetDate: string | null): number | null {
  if (!targetDate || !isValidDateStr(targetDate)) return null;
  return daysBetweenLocal(new Date(), targetDate);
}

/** stepper/chip display value for a target date — '' when no plan is set */
function prepDaysFor(targetDate: string | null): string {
  const days = daysUntilLocal(targetDate);
  return days !== null && days >= PREP_DAY_MIN && days <= PREP_DAY_MAX ? String(days) : '';
}

export interface SettingsScreenProps {
  settings: AppSettings;
  /** DB tracks only (the built-in 全部 isn't editable) */
  tracks: Track[];
  /** deck size per track id, for the picker labels */
  trackCounts: Record<string, number>;
  onSave: (s: AppSettings) => void;
  onAddTrack: (t: Track) => void;
  onDeleteTrack: (id: string) => void;
  onBack: () => void;
}

export function SettingsScreen({
  settings,
  tracks,
  trackCounts,
  onSave,
  onAddTrack,
  onDeleteTrack,
  onBack,
}: SettingsScreenProps) {
  const { colors } = useTheme();
  const [targetDate, setTargetDate] = useState(settings.targetDate ?? '');
  // '' = no plan set: nothing highlights, nothing pretends to be saved.
  // The previous default of '30' lit up the 30-天 chip while save() persisted
  // null — the UI advertised a plan that didn't exist.
  const [prepDays, setPrepDays] = useState(prepDaysFor(settings.targetDate));
  const [rhythm, setRhythm] = useState<RhythmId>(settings.rhythm);
  const [remindersEnabled, setRemindersEnabled] = useState(settings.remindersEnabled);
  const [morningTime, setMorningTime] = useState(settings.morningTime);
  const [eveningTime, setEveningTime] = useState(settings.eveningTime);
  const [newTrackName, setNewTrackName] = useState('');
  const [newTrackTags, setNewTrackTags] = useState('');

  const inputStyle = {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 9,
    paddingVertical: 9,
    paddingHorizontal: 11,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: colors.card,
  };

  const label = (t: string) => (
    <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 6, marginTop: 18 }}>{t}</Text>
  );

  const save = () => {
    const date = targetDate.trim();
    if (date && !isValidDateStr(date)) {
      Alert.alert('日期格式不对', '面试日期请用 YYYY-MM-DD，例如 2026-08-15；留空 = 不设截止。');
      return;
    }
    if (!isValidTimeStr(morningTime) || !isValidTimeStr(eveningTime)) {
      Alert.alert('时间格式不对', '提醒时间请用 HH:MM，例如 09:00。');
      return;
    }
    onSave({
      ...settings,
      targetDate: date || null,
      rhythm,
      remindersEnabled,
      morningTime,
      eveningTime,
    });
  };

  const applyPrepDays = (rawDays: number) => {
    const days = clampPrepDays(rawDays);
    setPrepDays(String(days));
    setTargetDate(localDateStr(addLocalDays(new Date(), days)));
  };

  /** ± steps from the currently shown value; from the empty state it starts the default plan */
  const stepPrepDays = (delta: number) => {
    if (!prepDays) {
      applyPrepDays(PREP_DAY_DEFAULT);
      return;
    }
    applyPrepDays(Number(prepDays) + delta);
  };

  const changePrepDaysText = (text: string) => {
    const digits = text.replace(/\D/g, '');
    setPrepDays(digits);
    if (!digits) return;
    applyPrepDays(Number(digits));
  };

  /** typing a date keeps the stepper in sync, so ± steps from the typed date, not a stale value */
  const changeTargetDate = (text: string) => {
    setTargetDate(text);
    setPrepDays(prepDaysFor(text.trim()));
  };

  const addTrack = () => {
    const name = newTrackName.trim();
    const tags = newTrackTags
      .split(/[,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (!name || tags.length === 0) {
      Alert.alert('路径没建成', '路径需要名字 + 至少一个 tag（逗号分隔，卡片带任一 tag 即算入该路径）。');
      return;
    }
    onAddTrack({ id: trackIdFromName(name, tracks), name, include: tags });
    setNewTrackName('');
    setNewTrackTags('');
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={10}>
          <Text style={{ color: colors.muted, fontSize: 15 }}>‹ 返回</Text>
        </Pressable>
        <Text style={{ color: colors.ink, fontSize: 16, fontWeight: '600' }}>设置</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
      >
        {label('面试日期（规划器据此算每天新卡量；留空 = 默认节奏）')}
        <TextInput
          value={targetDate}
          onChangeText={changeTargetDate}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          style={inputStyle}
        />

        {label('准备时间（1-60 天，选择后自动设置面试日期）')}
        <View style={[styles.prepRow, { borderColor: colors.line, backgroundColor: colors.card }]}>
          <Pressable onPress={() => stepPrepDays(-1)} style={styles.stepperButton}>
            <Text style={{ color: colors.ink, fontSize: 20, fontWeight: '600' }}>−</Text>
          </Pressable>
          <TextInput
            value={prepDays}
            onChangeText={changePrepDaysText}
            keyboardType="number-pad"
            placeholder="未设置"
            placeholderTextColor={colors.muted}
            style={[styles.prepInput, { color: colors.ink }]}
          />
          <Text style={{ color: colors.muted, fontSize: 14 }}>天</Text>
          <Pressable onPress={() => stepPrepDays(1)} style={styles.stepperButton}>
            <Text style={{ color: colors.ink, fontSize: 20, fontWeight: '600' }}>＋</Text>
          </Pressable>
        </View>
        <View style={styles.presetRow}>
          {PREP_DAY_PRESETS.map((days) => {
            const on = Number(prepDays) === days;
            return (
              <Pressable
                key={days}
                onPress={() => applyPrepDays(days)}
                style={[
                  styles.presetChip,
                  {
                    borderColor: on ? colors.accent : colors.line,
                    backgroundColor: on ? colors.accentSoft : colors.card,
                  },
                ]}
              >
                <Text style={{ color: on ? colors.accent : colors.ink, fontSize: 13 }}>{days} 天</Text>
              </Pressable>
            );
          })}
        </View>

        {label('学习节奏（同一个选择：定提醒频率 + 调 FSRS 强度；排期永远由 FSRS 算）')}
        <View style={{ gap: 8 }}>
          {(Object.keys(RHYTHMS) as RhythmId[]).map((id) => {
            const preset = RHYTHMS[id];
            const on = rhythm === id;
            return (
              <Pressable
                key={id}
                onPress={() => setRhythm(id)}
                style={[
                  styles.rhythmRow,
                  {
                    borderColor: on ? colors.accent : colors.line,
                    backgroundColor: on ? colors.accentSoft : colors.card,
                  },
                ]}
              >
                <Text style={{ fontSize: 15, fontWeight: '600', color: on ? colors.accent : colors.ink }}>
                  {preset.label}
                </Text>
                <Text style={{ fontSize: 12.5, color: colors.muted, marginTop: 3 }}>
                  {preset.description}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {label('提醒')}
        <Pressable
          onPress={() => setRemindersEnabled(!remindersEnabled)}
          style={[
            styles.rhythmRow,
            {
              borderColor: remindersEnabled ? colors.accent : colors.line,
              backgroundColor: remindersEnabled ? colors.accentSoft : colors.card,
            },
          ]}
        >
          <Text style={{ fontSize: 15, color: remindersEnabled ? colors.accent : colors.ink }}>
            {remindersEnabled ? '🔔 提醒已开启' : '🔕 提醒已关闭（点击开启）'}
          </Text>
        </Pressable>
        {remindersEnabled ? (
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>早上</Text>
              <TextInput value={morningTime} onChangeText={setMorningTime} placeholder="09:00" placeholderTextColor={colors.muted} style={inputStyle} />
            </View>
            {RHYTHMS[rhythm].eveningReminder ? (
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>晚上</Text>
                <TextInput value={eveningTime} onChangeText={setEveningTime} placeholder="21:00" placeholderTextColor={colors.muted} style={inputStyle} />
              </View>
            ) : null}
          </View>
        ) : null}

        {label('学习路径（track = tag 过滤器，取并集；可随时新增）')}
        <View style={{ gap: 8 }}>
          {tracks.map((t) => (
            <View key={t.id} style={[styles.trackRow, { borderColor: colors.line, backgroundColor: colors.card }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14.5, color: colors.ink, fontWeight: '600' }}>
                  {t.name} · {trackCounts[t.id] ?? 0} 张
                </Text>
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                  {t.include.join(' ∪ ')}
                </Text>
              </View>
              <Pressable
                onPress={() =>
                  Alert.alert('删除路径', `确定删除「${t.name}」？卡片与学习进度不受影响。`, [
                    { text: '取消', style: 'cancel' },
                    { text: '删除', style: 'destructive', onPress: () => onDeleteTrack(t.id) },
                  ])
                }
                hitSlop={8}
              >
                <Text style={{ color: colors.bad, fontSize: 13 }}>删除</Text>
              </Pressable>
            </View>
          ))}
        </View>
        <View style={{ marginTop: 10, gap: 8 }}>
          <TextInput value={newTrackName} onChangeText={setNewTrackName} placeholder="新路径名字，如 消息队列专项" placeholderTextColor={colors.muted} style={inputStyle} />
          <TextInput value={newTrackTags} onChangeText={setNewTrackTags} placeholder="包含的 tags（逗号分隔），如 kafka, queue" placeholderTextColor={colors.muted} autoCapitalize="none" style={inputStyle} />
          <GhostButton label="＋ 新增路径" onPress={addTrack} />
        </View>

        <View style={{ marginTop: 28 }}>
          <ActButton label="保存" onPress={save} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 10,
  },
  rhythmRow: { borderWidth: 1.5, borderRadius: 11, paddingVertical: 11, paddingHorizontal: 13 },
  prepRow: {
    borderWidth: 1.5,
    borderRadius: 11,
    paddingVertical: 8,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepperButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  prepInput: {
    flex: 1,
    minWidth: 48,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '700',
    paddingVertical: 6,
  },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  presetChip: { borderWidth: 1.5, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12 },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 11,
    paddingVertical: 10,
    paddingHorizontal: 13,
  },
});
