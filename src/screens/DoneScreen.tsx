import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../theme';
import { ActButton, GhostButton } from '../components/ui';
import { BigCelebration } from '../components/GameFeel';
import { feelBigWin } from '../feel';
import { isStreakMilestone, PLAN_CHUNK } from '../logic/gameFeel';
import type { SessionStats } from './SessionScreen';

export interface DoneScreenProps {
  stats: SessionStats;
  /** 今天一共投入的分钟数（所有路径，单张卡封顶 10 分钟） */
  todayMinutes: number;
  /** 当前范围里到明天结束前会到期的复习卡 */
  dueTomorrow: number;
  streak: number;
  soundEnabled: boolean;
  onBack: () => void;
  onExport: () => void;
}

/**
 * A3 结算画面（docs/DESIGN_game-feel_2026-10-11.md §7 拍板口径）：
 * 主角是「今天又坚持了 N 分钟」+「这组 y 张从忘记变成记住了」；
 * 小字只有 ✅/❌ 和明天到期数。不显示平均每张几秒、不和上周比快慢、不放 XP / 积分。
 * A2 大档：一进来全屏庆祝 1.8 秒 + 中震 + 三音上行；连续 7 / 30 / 100 天时点名。
 */
export function DoneScreen({ stats, todayMinutes, dueTomorrow, streak, soundEnabled, onBack, onExport }: DoneScreenProps) {
  const { colors } = useTheme();
  const didWork = stats.answered > 0;
  const milestone = isStreakMilestone(streak);
  const wrong = Math.max(0, stats.answered - stats.correct);

  useEffect(() => {
    if (didWork) feelBigWin(soundEnabled);
    // 只在进结算页的那一下响一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tomorrowText =
    dueTomorrow <= 0
      ? '明天没有到期的卡'
      : dueTomorrow > PLAN_CHUNK
        ? `明天的一组（${PLAN_CHUNK} 张）已经摆好`
        : `明天预计到期 ${dueTomorrow} 张`;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1, paddingHorizontal: 24, justifyContent: 'center', gap: 12 }}>
        <Text style={{ fontSize: 28, fontWeight: '800', color: colors.ink, textAlign: 'center', lineHeight: 38 }}>
          今天又坚持了 {Math.max(todayMinutes, didWork ? 1 : 0)} 分钟
        </Text>
        <Text style={{ fontSize: 24, fontWeight: '800', color: colors.ok, textAlign: 'center', lineHeight: 34 }}>
          {stats.learned > 0
            ? `这组 ${stats.learned} 张从忘记变成记住了`
            : `这组 ${stats.answered} 张都过了一遍`}
        </Text>
        {milestone ? (
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>
            🔥 连续 {streak} 天了
          </Text>
        ) : null}
        <View style={{ marginTop: 6, gap: 4 }}>
          {didWork ? (
            <Text style={{ fontSize: 14, color: colors.muted, textAlign: 'center' }}>
              ✅ {stats.correct} · ❌ {wrong}
            </Text>
          ) : null}
          <Text style={{ fontSize: 14, color: colors.muted, textAlign: 'center' }}>{tomorrowText}</Text>
        </View>
        <View style={{ marginTop: 16, gap: 10 }}>
          <ActButton label="返回" onPress={onBack} />
          <GhostButton label="⬇︎ 导出反馈" onPress={onExport} />
        </View>
      </View>
      {didWork ? <BigCelebration headline={milestone ? `🔥 连续 ${streak} 天` : null} /> : null}
    </View>
  );
}
