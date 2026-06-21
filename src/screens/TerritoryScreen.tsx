import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme';
import { cellWidth, type TerritoryCell, type TerritoryRow } from '../logic/territory';

export interface TerritoryScreenProps {
  rows: TerritoryRow[];
  /** 点一格 → 只刷这个模块（到期优先）。回 false = 这格今天没有能做的卡 */
  onPick: (cell: TerritoryCell) => boolean;
  onBack: () => void;
}

/**
 * 🗺 领地图：一行一条轨道，一格一个学习模块，三色。没有百分比、没有「还差多少」，只有颜色在变。
 * 像 GitHub 的绿格子，但横轴是内容不是日期——今天没做，格子也不会空。
 */
export function TerritoryScreen({ rows, onPick, onBack }: TerritoryScreenProps) {
  const { colors } = useTheme();
  const [emptyNote, setEmptyNote] = useState<string | null>(null);

  const fill = (s: TerritoryCell['status']) =>
    s === 'stable' ? colors.tealBg : s === 'learning' ? colors.amberBg : colors.card;
  const ink = (s: TerritoryCell['status']) =>
    s === 'stable' ? colors.tealInk : s === 'learning' ? colors.amberInk : colors.muted;

  const totalStable = rows.reduce((n, r) => n + r.stable, 0);
  const totalCards = rows.reduce((n, r) => n + r.total, 0);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={10} style={[styles.backBtn, { borderColor: colors.line }]}>
          <Text style={{ color: colors.ink, fontSize: 14, fontWeight: '600' }}>主页</Text>
        </Pressable>
        <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink }}>🗺 领地</Text>
        <View style={{ width: 52 }} />
      </View>
      <View style={styles.legend}>
        <Legend color={colors.tealBg} border={colors.tealInk} label="稳定" />
        <Legend color={colors.amberBg} border={colors.amberInk} label="在学" />
        <Legend color={colors.card} border={colors.line} label="没碰" />
        <Text style={{ fontSize: 12, color: colors.muted, marginLeft: 'auto' }}>
          已稳 {totalStable} / {totalCards} 张
        </Text>
      </View>
      {emptyNote ? (
        <Text style={{ fontSize: 13, color: colors.amberInk, marginTop: 8 }}>{emptyNote}</Text>
      ) : null}

      {rows.map((row) => (
        <View key={row.trackId} style={{ marginTop: 18 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 8 }}>
            {row.trackName}
            <Text style={{ fontSize: 12, fontWeight: '400', color: colors.muted }}>
              {'  '}{row.cells.length} 格
            </Text>
          </Text>
          <View style={styles.grid}>
            {row.cells.map((cell) => {
              const share = cell.total ? cell.stable / cell.total : 0;
              return (
                <Pressable
                  key={cell.category}
                  onPress={() => {
                    const ok = onPick(cell);
                    setEmptyNote(ok ? null : `「${cell.category}」今天的卡都做过了，明天再来。`);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${cell.category}，${cell.total} 张，${cell.status === 'stable' ? '稳定' : cell.status === 'learning' ? '在学' : '没碰'}`}
                  style={({ pressed }) => [
                    styles.cell,
                    {
                      width: cellWidth(cell.total),
                      backgroundColor: fill(cell.status),
                      borderColor: pressed ? colors.accent : cell.status === 'untouched' ? colors.line : fill(cell.status),
                    },
                  ]}
                >
                  <Text numberOfLines={2} style={{ fontSize: 12, lineHeight: 15, color: ink(cell.status), fontWeight: '600' }}>
                    {cell.category}
                  </Text>
                  {/* 在学的格子：底边一条细线，长度 = 稳定的份额。不写数字。 */}
                  {cell.status === 'learning' && share > 0 ? (
                    <View style={[styles.bar, { width: `${Math.round(share * 100)}%`, backgroundColor: colors.tealInk }]} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function Legend({ color, border, label }: { color: string; border: string; label: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: color, borderWidth: 1, borderColor: border }} />
      <Text style={{ fontSize: 12, color: colors.muted }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8 },
  backBtn: { borderWidth: 1.5, borderRadius: 99, paddingVertical: 6, paddingHorizontal: 12, width: 52, alignItems: 'center' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cell: { minHeight: 44, borderRadius: 8, borderWidth: 1.5, paddingVertical: 6, paddingHorizontal: 8, justifyContent: 'center', overflow: 'hidden' },
  bar: { position: 'absolute', left: 0, bottom: 0, height: 3, borderTopRightRadius: 2 },
});
