import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme';
import type { Card } from '../types';

export interface CardCurationScreenProps {
  title: string;
  cards: Card[];
  onDeleteCard: (cardId: string) => Promise<void>;
  onBack: () => void;
}

/** A deliberately non-drill view for pruning an overgrown module. */
export function CardCurationScreen({ title, cards, onDeleteCard, onBack }: CardCurationScreenProps) {
  const { colors } = useTheme();
  const [visibleCards, setVisibleCards] = useState(cards);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setVisibleCards(cards), [cards]);

  const remove = async (cardId: string) => {
    setSavingId(cardId);
    setError(null);
    try {
      await onDeleteCard(cardId);
      setVisibleCards((current) => current.filter((card) => card.id !== cardId));
      setConfirmingId(null);
    } catch {
      setError('这一张暂时没能移除，请再试一次。');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <FlatList
      data={visibleCards}
      keyExtractor={(card) => card.id}
      contentContainerStyle={styles.content}
      ListHeaderComponent={
        <View style={styles.header}>
          <Pressable onPress={onBack} hitSlop={8}>
            <Text style={{ color: colors.accent, fontSize: 15, fontWeight: '700' }}>‹ 返回</Text>
          </Pressable>
          <Text style={{ color: colors.ink, fontSize: 21, fontWeight: '700', marginTop: 14 }}>{title}</Text>
          <Text style={{ color: colors.muted, fontSize: 13, marginTop: 5 }}>还剩 {visibleCards.length} 张</Text>
          {error ? <Text style={{ color: colors.bad, fontSize: 13, marginTop: 8 }}>{error}</Text> : null}
        </View>
      }
      ListEmptyComponent={
        <View style={[styles.empty, { borderColor: colors.line, backgroundColor: colors.card }]}>
          <Text style={{ color: colors.ink, fontSize: 16, fontWeight: '700' }}>这一站已经清空</Text>
        </View>
      }
      renderItem={({ item: card, index }) => {
        const confirming = confirmingId === card.id;
        const saving = savingId === card.id;
        return (
          <View style={[styles.row, { borderColor: colors.line, backgroundColor: colors.card }]}>
            <View style={styles.rowTop}>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{String(index + 1).padStart(2, '0')}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>{card.sub}</Text>
            </View>
            <Text style={{ color: colors.ink, fontSize: 15, fontWeight: '700', lineHeight: 22, marginTop: 7 }}>
              {card.q}
            </Text>
            {card.scenario ? (
              <Text style={{ color: colors.muted, fontSize: 12.5, lineHeight: 18, marginTop: 6 }} numberOfLines={2}>
                {card.scenario}
              </Text>
            ) : null}
            {!confirming ? (
              <Pressable onPress={() => setConfirmingId(card.id)} hitSlop={8} style={styles.removeEntry}>
                <Text style={{ color: colors.bad, fontSize: 13, fontWeight: '700' }}>移除</Text>
              </Pressable>
            ) : (
              <View style={styles.confirmRow}>
                <Pressable
                  onPress={() => void remove(card.id)}
                  disabled={saving}
                  style={[styles.confirmButton, { backgroundColor: saving ? colors.line : colors.bad }]}
                >
                  <Text style={{ color: saving ? colors.muted : '#fff', fontSize: 13, fontWeight: '700' }}>
                    {saving ? '移除中…' : '确认移除'}
                  </Text>
                </Pressable>
                <Pressable onPress={() => setConfirmingId(null)} disabled={saving} hitSlop={8}>
                  <Text style={{ color: colors.muted, fontSize: 13 }}>取消</Text>
                </Pressable>
              </View>
            )}
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  header: { paddingTop: 16, paddingBottom: 15 },
  row: { borderWidth: 1, borderRadius: 8, padding: 13, marginBottom: 9 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  removeEntry: { alignSelf: 'flex-start', marginTop: 11 },
  confirmRow: { flexDirection: 'row', alignItems: 'center', gap: 13, marginTop: 11 },
  confirmButton: { borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  empty: { borderWidth: 1, borderRadius: 8, padding: 18, alignItems: 'center', marginTop: 6 },
});
