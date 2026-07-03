import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme';

export interface AnswerOptionDetail {
  label: string;
  text: string;
  isCorrect: boolean;
  wasPicked: boolean;
  meaning: string;
  scenarioImpact: string;
  directness: string;
  explanationEn?: string;
}

export function AnswerDetailPad({ details }: { details: AnswerOptionDetail[] }) {
  const { colors } = useTheme();
  if (!details.length) return null;

  return (
    <View style={[styles.wrap, { borderColor: colors.line, backgroundColor: colors.chip }]}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: colors.ink }]}>选项含义拆解</Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{details.length} 个选项</Text>
      </View>

      <View style={styles.items}>
        {details.map((detail) => {
          const borderColor = detail.isCorrect ? colors.ok : detail.wasPicked ? colors.bad : colors.line;
          const backgroundColor = detail.isCorrect
            ? colors.okBg
            : detail.wasPicked
              ? colors.badBg
              : colors.card;
          const status = detail.isCorrect ? '最佳答案' : detail.wasPicked ? '你选了它：看差异' : '备选方案：差在哪';
          const statusColor = detail.isCorrect ? colors.ok : detail.wasPicked ? colors.bad : colors.muted;
          // One flowing paragraph per option (是什么 → 放到场景 → 为何[不]直接), not
          // three labeled sections — the structure lives in sentence order, the
          // per-option section headers were pure visual tax.
          const zh = [detail.meaning, detail.scenarioImpact, detail.directness]
            .map((s) => s.trim())
            .filter(Boolean)
            .join(' ');

          return (
            <View key={detail.label} style={[styles.item, { borderColor, backgroundColor }]}>
              <View style={styles.itemTop}>
                <View style={[styles.badge, { borderColor: statusColor }]}>
                  <Text style={{ color: statusColor, fontWeight: '700' }}>{detail.label}</Text>
                </View>
                <Text style={{ color: statusColor, fontSize: 13, fontWeight: '700' }}>{status}</Text>
              </View>

              <Text style={[styles.optionText, { color: colors.ink }]}>{detail.text}</Text>

              {zh ? <Text style={[styles.explanation, { color: colors.ink }]}>{zh}</Text> : null}

              {detail.explanationEn ? (
                <Text style={[styles.explanationEn, { color: colors.muted }]}>{detail.explanationEn}</Text>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 13,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  title: { fontSize: 15, fontWeight: '800' },
  items: { gap: 10 },
  item: { borderWidth: 1.5, borderRadius: 11, padding: 12 },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  badge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: { fontSize: 14.5, lineHeight: 21, fontWeight: '600', marginBottom: 8 },
  explanation: { fontSize: 14, lineHeight: 21 },
  explanationEn: { fontSize: 13, lineHeight: 19, marginTop: 7, fontStyle: 'italic' },
});
