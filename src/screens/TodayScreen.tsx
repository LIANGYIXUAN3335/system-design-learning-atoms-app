import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme';
import { ActButton, GhostButton } from '../components/ui';
import { RECOMMENDED_NEW_PER_DAY } from '../config';
import type { Track } from '../types';
import { categoryStatus } from '../logic/categories';

const ROADMAP_PHASES = ['首轮', '深挖', '补漏'] as const;

export interface RoadmapStagePill {
  id: string;
  label: string;
  phase: (typeof ROADMAP_PHASES)[number];
  total: number;
  seen: number;
  mastered: number;
}

export interface TodayStats {
  /** cards in the active track */
  deckSize: number;
  dueCount: number;
  newCount: number;
  /** distinct cards answered today within the active track */
  todayDone: number;
  /** goal denominator: done + still-due + remaining new quota */
  todayTarget: number;
  /** A5：这一组的张数（队列超过 PLAN_CHUNK 时只取前 PLAN_CHUNK 张），首页只报它 */
  planCount: number;
  /** A5：这一组按她的历史中位数估的分钟数 */
  planMinutes: number;
  /** B4：今天做过的卡（去重，所有路径） */
  todayCardsAll: number;
  /** B4 / A3：今天投入的分钟数（所有路径） */
  todayMinutes: number;
  /** A3：当前范围里到明天结束前会到期的复习卡 */
  dueTomorrow: number;
  /** B4：当天做过 ≥1 张就算一天 */
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
  /** stage progress rendered only inside the classic system-design track */
  roadmapStages: RoadmapStagePill[];
  categories: CategoryPill[];
}

export interface CategoryPill {
  id: string;
  name: string;
  total: number;
  mastered: number;
  seen: number;
}

export interface TodayScreenProps {
  stats: TodayStats;
  tracks: Track[];
  activeTrackId: string;
  activeRoadmapStage: string;
  activeCategory: string;
  onSelectTrack: (id: string) => void;
  onSelectRoadmapStage: (id: string) => void;
  onSelectCategory: (id: string) => void;
  onStart: () => void;
  onStartReviews: () => void;
  onStartNew: () => void;
  onExport: () => void;
  onRefresh: () => void;
  onSettings: () => void;
  /** 🎤 口语复盘 —— 不是卡池，是另一种练习，所以放标题行不放 track chip（M4 §4） */
  onRecite: () => void;
}

export function TodayScreen({
  stats,
  tracks,
  activeTrackId,
  activeRoadmapStage,
  activeCategory,
  onSelectTrack,
  onSelectRoadmapStage,
  onSelectCategory,
  onStart,
  onStartReviews,
  onStartNew,
  onExport,
  onRefresh,
  onSettings,
  onRecite,
}: TodayScreenProps) {
  const { colors } = useTheme();
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
  const showSystemDesignRoadmap = activeTrackId === 'classic-sd';

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}>
      <View style={styles.headerRow}>
        <View>
          <Text style={{ fontSize: 24, fontWeight: '700', color: colors.ink }}>Atoms</Text>
          {/* B4：跨天连续感。做 1 张就算一天；没有目标值、没有冻结卡 */}
          <Text style={{ fontSize: 14, color: colors.ink, fontWeight: '600', marginTop: 4 }}>
            🔥 连续 {stats.streak} 天 · 今天做了 {stats.todayCardsAll} 张 / {stats.todayMinutes} 分钟
          </Text>
          <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
            {stats.deckSize} 张卡 · 已掌握 {stats.masteredCount}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Pressable
            onPress={onRecite}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="口语复盘"
            style={[styles.gear, { flexDirection: 'row', alignItems: 'center', gap: 4 }]}
          >
            <Text style={{ fontSize: 18 }}>🎤</Text>
            <Text style={{ fontSize: 13, color: colors.muted }}>口语复盘</Text>
          </Pressable>
          <Pressable onPress={onSettings} hitSlop={10} style={styles.gear}>
            <Text style={{ fontSize: 20 }}>⚙️</Text>
          </Pressable>
        </View>
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

      {showSystemDesignRoadmap ? (
        <View style={[styles.pathHint, { borderColor: colors.line, backgroundColor: colors.accentSoft }]}>
          <Text style={{ color: colors.ink, fontSize: 13, fontWeight: '700' }}>经典系统设计路线</Text>
          <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 3 }}>
            先走首轮，再按顺序深挖；补漏只在 mock 或真实面试暴露缺口时打开。
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 9 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                onPress={() => onSelectRoadmapStage('all')}
                style={[
                  styles.roadmapChip,
                  {
                    borderColor: activeRoadmapStage === 'all' ? colors.accent : colors.line,
                    backgroundColor: activeRoadmapStage === 'all' ? colors.card : 'transparent',
                  },
                ]}
              >
                <Text style={{ color: activeRoadmapStage === 'all' ? colors.accent : colors.ink, fontSize: 12.5, fontWeight: '700' }}>
                  总览
                </Text>
              </Pressable>
            </View>
          </ScrollView>
          {ROADMAP_PHASES.map((phase) => {
            const stages = stats.roadmapStages.filter((stage) => stage.phase === phase);
            if (!stages.length) return null;
            return (
              <View key={phase} style={{ marginTop: 9 }}>
                <Text style={{ color: colors.muted, fontSize: 11.5, fontWeight: '700' }}>{phase}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 5 }}>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {stages.map((stage) => {
                      const selected = activeRoadmapStage === stage.id;
                      return (
                        <Pressable
                          key={stage.id}
                          onPress={() => onSelectRoadmapStage(stage.id)}
                          style={[
                            styles.roadmapChip,
                            {
                              borderColor: selected ? colors.accent : colors.line,
                              backgroundColor: selected ? colors.card : 'transparent',
                            },
                          ]}
                        >
                          <Text style={{ color: selected ? colors.accent : colors.ink, fontSize: 12.5, fontWeight: '700' }}>
                            {stage.label}
                          </Text>
                          <Text style={{ color: colors.muted, fontSize: 11, marginTop: 3 }}>
                            已刷 {stage.seen}/{stage.total}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </ScrollView>
              </View>
            );
          })}
        </View>
      ) : null}

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
              const status = categoryStatus(category);
              const dotColor =
                status === 'covered' ? '#3fb883' : status === 'in-progress' ? '#e2a33b' : colors.muted;
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
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <View
                      accessibilityLabel={status === 'covered' ? '已刷完' : status === 'in-progress' ? '进行中' : '未开始'}
                      style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: dotColor }}
                    />
                    <Text style={{ color: on ? colors.accent : colors.ink, fontSize: 13.5, fontWeight: '700' }}>
                      {category.name}
                    </Text>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: 3 }}>
                    已刷 {category.seen}/{category.total} · 掌握 {mastery}%
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </View>

      {/* A5：不放「今日目标 x/总数」也不放积压数，只留节奏这一行小字 */}
      <Text style={{ fontSize: 12.5, color: colors.muted, marginTop: 16 }}>
        {stats.daysLeft !== null ? `距面试 ${stats.daysLeft} 天 · ${paceText}` : paceText}
      </Text>

      {stats.plannerWarning ? (
        <View style={[styles.warnBox, { backgroundColor: colors.amberBg }]}>
          <Text style={{ fontSize: 13, color: colors.amberInk, lineHeight: 19 }}>
            ⚠️ {stats.plannerWarning}
          </Text>
        </View>
      ) : null}

      <View style={{ marginTop: 14, gap: 10 }}>
        {stats.planCount > 0 ? (
          <>
            {/* A5：只说「这一组」，队列再长也不把总数砸脸上 */}
            <View style={[styles.planBox, { backgroundColor: colors.card, borderColor: colors.line }]}>
              <Text style={{ color: colors.ink, fontSize: 18, fontWeight: '700', textAlign: 'center' }}>
                今天做这 {stats.planCount} 张，约 {stats.planMinutes} 分钟
              </Text>
            </View>
            <ActButton label="开始" onPress={onStart} />
            {stats.dueCount > 0 && stats.newCount > 0 ? (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <GhostButton label="只刷复习" onPress={onStartReviews} style={{ flex: 1 }} />
                <GhostButton label="只学新卡" onPress={onStartNew} style={{ flex: 1 }} />
              </View>
            ) : null}
          </>
        ) : (
          <View style={[styles.doneBox, { backgroundColor: colors.okBg }]}>
            <Text style={{ color: colors.ok, fontSize: 15, fontWeight: '600' }}>
              今天的卡都做完了 🎉
            </Text>
            {stats.laterToday > 0 ? (
              <Text style={{ color: colors.ok, fontSize: 13, marginTop: 4 }}>
                稍后还有 {stats.laterToday} 张今天到期（学习步骤），到点回来刷
              </Text>
            ) : null}
          </View>
        )}
        {stats.laterToday > 0 && stats.planCount > 0 ? (
          <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center' }}>
            另有 {stats.laterToday} 张稍后今天到期
          </Text>
        ) : null}
        {stats.otherTracksDue > 0 ? (
          <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center' }}>
            其他路径也有到期的卡，想做的时候切过去
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
  pathHint: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginTop: 12 },
  roadmapChip: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, minWidth: 106 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  categoryChip: { borderWidth: 1.5, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 11, minWidth: 132 },
  planBox: { borderWidth: 1, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 14 },
  warnBox: { borderRadius: 10, padding: 11, marginTop: 12 },
  doneBox: { borderRadius: 12, padding: 14, alignItems: 'center' },
});
