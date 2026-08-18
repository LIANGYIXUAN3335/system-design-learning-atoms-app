import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme';
import { DELIVERABLE_LABEL, type Card } from '../types';
import type { SrsEntry } from '../logic/queue';

export interface ProduceTopic {
  /** category 名（= 题目名，例如 Uber） */
  category: string;
  cards: Card[];
  /** 有 SRS 记录的张数（做过几张） */
  seen: number;
}

/** 按 deliverable 的合同顺序排 produce 卡：实体 → schema → API → 组件图 → 主流程 → 状态机 → 并发 → 恢复 → 扩展 → 选型 */
const ORDER: Array<Card['deliverable']> = [
  'entities', 'schema', 'api', 'components', 'flow', 'state', 'concurrency', 'recovery', 'scaling', 'tech',
];
export function orderProduceCards(cards: Card[]): Card[] {
  const rank = (c: Card) => {
    const i = ORDER.indexOf(c.deliverable);
    return i < 0 ? ORDER.length : i;
  };
  return [...cards].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
}

export function buildProduceTopics(cards: Card[], srs: Map<string, SrsEntry>): ProduceTopic[] {
  const byCat = new Map<string, Card[]>();
  for (const c of cards) {
    if (c.format !== 'produce') continue;
    const k = c.category ?? 'Uncategorized';
    byCat.set(k, [...(byCat.get(k) ?? []), c]);
  }
  return [...byCat.entries()]
    .map(([category, list]) => ({
      category,
      cards: orderProduceCards(list),
      seen: list.filter((c) => srs.has(c.id)).length,
    }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

export interface ProducePickerScreenProps {
  topics: ProduceTopic[];
  onPick: (topic: ProduceTopic) => void;
  onBack: () => void;
}

/**
 * ✍️ 白纸：选一道题，把它的 produce 卡按合同顺序过一遍 = 合上笔记从白纸写一遍这个系统。
 * 不看到期、不限新卡数——这是一次完整演练，不是复习队列。
 */
export function ProducePickerScreen({ topics, onPick, onBack }: ProducePickerScreenProps) {
  const { colors } = useTheme();
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={10} style={[styles.backBtn, { borderColor: colors.line }]}>
          <Text style={{ color: colors.ink, fontSize: 14, fontWeight: '600' }}>主页</Text>
        </Pressable>
        <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink }}>✍️ 白纸</Text>
        <View style={{ width: 52 }} />
      </View>
      <Text style={{ fontSize: 13, lineHeight: 19, color: colors.muted, marginTop: 10 }}>
        选一道题，按「实体 → schema → API → 组件图 → 主流程 → 状态机 → 并发 → 恢复」的顺序，每张卡先在纸上写、再翻面对清单。一轮约 15–20 分钟。
      </Text>
      {topics.length === 0 ? (
        <Text style={{ fontSize: 14, color: colors.amberInk, marginTop: 18 }}>还没有题目带 produce 卡。</Text>
      ) : null}
      <View style={{ marginTop: 14, gap: 10 }}>
        {topics.map((t) => {
          const kinds = [...new Set(t.cards.map((c) => c.deliverable).filter(Boolean))] as Array<
            NonNullable<Card['deliverable']>
          >;
          return (
            <Pressable
              key={t.category}
              onPress={() => onPick(t)}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.topic,
                { backgroundColor: colors.card, borderColor: pressed ? colors.accent : colors.line },
              ]}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>{t.category}</Text>
                <Text style={{ fontSize: 12, color: colors.muted }}>
                  {t.cards.length} 张 · 写过 {t.seen}
                </Text>
              </View>
              <Text style={{ fontSize: 12.5, lineHeight: 18, color: colors.muted, marginTop: 4 }}>
                {kinds.map((k) => DELIVERABLE_LABEL[k]).join(' → ')}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 6 },
  backBtn: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, minWidth: 52, alignItems: 'center' },
  topic: { borderWidth: 1, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16 },
});
