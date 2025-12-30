import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme';
import { ActButton, GhostButton, ProgressBar } from '../components/ui';
import { RECOMMENDED_NEW_PER_DAY } from '../config';
import type { Track } from '../types';

export interface TodayStats {
  /** cards in the active track */
  deckSize: number;
  dueCount: number;
  newCount: number;
  /** distinct cards answered today within the active track */
  todayDone: number;
  /** goal denominator: done + still-due + remaining new quota */
  todayTarget: number;
  streak: number;
  laterToday: number;
  /** due cards outside the active track (visibility for FSRS debt, review §2.5) */
  otherTracksDue: number;
  feedbackCount: number;
  masteredCount: number;
  /** planner outputs */
  newPerDay: number;
  rawNewPerDay: number | null;
  daysLeft: number | null;
  /** M3 §3.2: deadline-scaled floor (days) for a correct-but-fuzzy card */
  correctFuzzyFloor: number;
  /** M3 §3.2 Phase 3: within the final-stretch window → weak-set drilling */
  finalStretch: boolean;
  plannerWarning: string | null;
  /** a specific module is selected: finite set, no daily quota — finish it */
  focusedModule: boolean;
  categories: CategoryPill[];
}

export interface CategoryPill {
  id: string;
  name: string;
  total: number;
  mastered: number;
}

export interface TodayScreenProps {
  stats: TodayStats;
  tracks: Track[];
  activeTrackId: string;
  activeCategory: string;
  onSelectTrack: (id: string) => void;
  onSelectCategory: (id: string) => void;
  onStart: () => void;
  onStartReviews: () => void;
  onStartNew: () => void;
  onExport: () => void;
  onRefresh: () => void;
  onSettings: () => void;
}

export function TodayScreen({
  stats,
  tracks,
  activeTrackId,
  activeCategory,
  onSelectTrack,
  onSelectCategory,
  onStart,
  onStartReviews,
  onStartNew,
  onExport,
  onRefresh,
  onSettings,
}: TodayScreenProps) {
  const { colors } = useTheme();
  const total = stats.dueCount + stats.newCount;
  const goalRatio = stats.todayTarget > 0 ? stats.todayDone / stats.todayTarget : 1;
  const isAboveRecommendation =
    !stats.focusedModule &&
    stats.rawNewPerDay !== null &&
    stats.rawNewPerDay === stats.newPerDay &&
    stats.newPerDay > RECOMMENDED_NEW_PER_DAY;
  const paceText = stats.focusedModule
    ? '本模块 · 刷完为止'
    : isAboveRecommendation
      ? `新卡 ${stats.newPerDay}/天 · 推荐 ${RECOMMENDED_NEW_PER_DAY}/天`
      : `新卡 ${stats.newPerDay}/天`;

  const Stat = ({ label, value, onPress }: { label: string; value: number; onPress?: () => void }) => {
    const enabled = Boolean(onPress && value > 0);
    const content = (
      <>
        <Text style={{ fontSize: 26, fontWeight: '700', color: colors.ink }}>{value}</Text>
        <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{label}</Text>
      </>
    );
    const statStyle = [styles.stat, { backgroundColor: colors.card, borderColor: colors.line }];

    if (!enabled) return <View style={statStyle}>{content}</View>;

    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [statStyle, pressed ? styles.statPressed : null]}
      >
        {content}
      </Pressable>
    );
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}>
      <View style={styles.headerRow}>
        <View>
          <Text style={{ fontSize: 24, fontWeight: '700', color: colors.ink }}>Atoms</Text>
          <Text style={{ fontSize: 13, color: colors.muted, marginTop: 3 }}>
            {stats.deckSize} 张卡 · 已掌握 {stats.masteredCount} · 🔥 连续 {stats.streak} 天
          </Text>
        </View>
        <Pressable onPress={onSettings} hitSlop={10} style={styles.gear}>
          <Text style={{ fontSize: 20 }}>⚙️</Text>
        </Pressable>
      </View>

      {/* track picker */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {tracks.map((t) => {
            const on = t.id === activeTrackId;
            return (
              <Pressable
                key={t.id}
                onPress={() => onSelectTrack(t.id)}
                style={[
                  styles.trackChip,
                  {
                    borderColor: on ? colors.accent : colors.line,
                    backgroundColor: on ? colors.accentSoft : colors.card,
                  },
                ]}
              >
                <Text style={{ fontSize: 13.5, color: on ? colors.accent : colors.ink, fontWeight: on ? '600' : '400' }}>
                  {t.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={{ marginTop: 14 }}>
        <View style={styles.sectionHeader}>
          <Text style={{ color: colors.ink, fontSize: 15, fontWeight: '700' }}>模块</Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>{stats.categories.length} 个分类</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {stats.categories.map((category) => {
              const on = category.id === activeCategory;
              const mastery =
                category.total > 0 ? Math.round((category.mastered / category.total) * 100) : 0;
              return (
                <Pressable
                  key={category.id}
                  onPress={() => onSelectCategory(category.id)}
                  style={[
                    styles.categoryChip,
                    {
                      borderColor: on ? colors.accent : colors.line,
                      backgroundColor: on ? colors.accentSoft : colors.card,
                    },
                  ]}
                >
                  <Text style={{ color: on ? colors.accent : colors.ink, fontSize: 13.5, fontWeight: '700' }}>
                    {category.name}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: 3 }}>
                    {category.total} 张 · 掌握 {mastery}%
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </View>

      {/* daily goal ring */}
      <View style={{ marginTop: 16 }}>
        <View style={styles.goalRow}>
          <Text style={{ fontSize: 13, color: colors.muted }}>
            今日目标 {Math.min(stats.todayDone, stats.todayTarget)}/{stats.todayTarget}
          </Text>
          {stats.daysLeft !== null ? (
            <Text style={{ fontSize: 13, color: colors.muted }}>
              距面试 {stats.daysLeft} 天 · {paceText}
            </Text>
          ) : (
            <Text style={{ fontSize: 13, color: colors.muted }}>{paceText}</Text>
          )}
        </View>
        <ProgressBar ratio={goalRatio} />
      </View>

      {stats.plannerWarning ? (
        <View style={[styles.warnBox, { backgroundColor: colors.amberBg }]}>
          <Text style={{ fontSize: 13, color: colors.amberInk, lineHeight: 19 }}>
            ⚠️ {stats.plannerWarning}
          </Text>
        </View>
      ) : null}

      <View style={[styles.statRow, { marginTop: 14 }]}>
        <Stat label="待复习" value={stats.dueCount} onPress={onStartReviews} />
        <Stat label="新卡" value={stats.newCount} onPress={onStartNew} />
        <Stat label="今日斩杀" value={stats.todayDone} />
      </View>

      <View style={{ marginTop: 18, gap: 10 }}>
        {total > 0 ? (
          <ActButton label={`开始刷题（${total} 张）`} onPress={onStart} />
        ) : (
          <View style={[styles.doneBox, { backgroundColor: colors.okBg }]}>
            <Text style={{ color: colors.ok, fontSize: 15, fontWeight: '600' }}>
              今日队列已清空 🎉 🔥 连续 {stats.streak} 天
            </Text>
            {stats.laterToday > 0 ? (
              <Text style={{ color: colors.ok, fontSize: 13, marginTop: 4 }}>
                稍后还有 {stats.laterToday} 张今天到期（学习步骤），到点回来刷
              </Text>
            ) : null}
          </View>
        )}
        {stats.laterToday > 0 && total > 0 ? (
          <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center' }}>
            另有 {stats.laterToday} 张稍后今天到期
          </Text>
        ) : null}
        {stats.otherTracksDue > 0 ? (
          <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center' }}>
            其他路径另有 {stats.otherTracksDue} 张到期——切换路径去清
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <GhostButton label={`⬇︎ 导出反馈（${stats.feedbackCount}）`} onPress={onExport} style={{ flex: 1 }} />
          <GhostButton label="刷新" onPress={onRefresh} />
        </View>
      </View>

      <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: 26 }}>
        全部数据在手机本地 (SQLite + FSRS) · 无网络依赖
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 8 },
  gear: { padding: 4 },
  trackChip: { borderWidth: 1.5, borderRadius: 99, paddingVertical: 7, paddingHorizontal: 14 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  categoryChip: { borderWidth: 1.5, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 11, minWidth: 132 },
  goalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  warnBox: { borderRadius: 10, padding: 11, marginTop: 12 },
  statRow: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, borderWidth: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  statPressed: { opacity: 0.72 },
  doneBox: { borderRadius: 12, padding: 14, alignItems: 'center' },
});
