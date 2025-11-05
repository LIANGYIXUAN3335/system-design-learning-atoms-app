import React from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../theme';
import { ActButton, GhostButton } from '../components/ui';
import type { SessionStats } from './SessionScreen';

export interface DoneScreenProps {
  stats: SessionStats;
  /** distinct cards answered today within the active track */
  todayDone: number;
  /** today's goal target (done + still-due + remaining new quota) */
  todayTarget: number;
  streak: number;
  laterToday: number;
  onBack: () => void;
  onExport: () => void;
}

/** 斩杀 framing per spec §2: 本次斩杀 X · 今日 Y/Z · 🔥 连续 N 天. */
export function DoneScreen({
  stats,
  todayDone,
  todayTarget,
  streak,
  laterToday,
  onBack,
  onExport,
}: DoneScreenProps) {
  const { colors } = useTheme();
  const goalHit = todayTarget > 0 && todayDone >= todayTarget;
  return (
    <View style={{ flex: 1, paddingHorizontal: 24, justifyContent: 'center', gap: 12 }}>
      <Text style={{ fontSize: 26, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>
        {goalHit ? '今日目标达成 🎉' : '本次刷完 ⚔️'}
      </Text>
      <Text style={{ fontSize: 16, color: colors.ink, textAlign: 'center' }}>
        本次斩杀 {stats.answered} · 今日 {Math.min(todayDone, todayTarget)}/{todayTarget} · 🔥 连续{' '}
        {streak} 天
      </Text>
      {stats.answered > 0 ? (
        <Text style={{ fontSize: 13, color: colors.muted, textAlign: 'center' }}>
          客观答对 {stats.correct}/{stats.answered}
        </Text>
      ) : null}
      {goalHit ? (
        <Text style={{ fontSize: 14, color: colors.ok, textAlign: 'center', fontWeight: '600' }}>
          队列已清空——明天见，别断火 🔥
        </Text>
      ) : laterToday > 0 ? (
        <Text style={{ fontSize: 13, color: colors.muted, textAlign: 'center' }}>
          稍后还有 {laterToday} 张今天到期（学习步骤），到点回来刷
        </Text>
      ) : null}
      <View style={{ marginTop: 16, gap: 10 }}>
        <ActButton label="返回" onPress={onBack} />
        <GhostButton label="⬇︎ 导出反馈" onPress={onExport} />
      </View>
    </View>
  );
}
