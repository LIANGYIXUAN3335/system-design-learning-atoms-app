import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme';
import type { CardNumberAnchor } from '../types';

export function NumberAnchors({ anchors }: { anchors?: CardNumberAnchor[] }) {
  const { colors } = useTheme();
  if (!anchors?.length) return null;

  return (
    <View style={[styles.wrap, { borderColor: colors.line, backgroundColor: colors.chip }]}>
      <Text style={[styles.title, { color: colors.muted }]}>数字锚点</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={[styles.table, { borderColor: colors.line, backgroundColor: colors.card }]}>
          <View style={[styles.row, { backgroundColor: colors.chip }]}>
            {['系统', '扩展单位', '面试粗估', '风险'].map((header) => (
              <View key={header} style={[styles.cell, { borderColor: colors.line }]}>
                <Text style={[styles.header, { color: colors.muted }]}>{header}</Text>
              </View>
            ))}
          </View>
          {anchors.map((anchor) => (
            <View key={anchor.system} style={[styles.row, { borderTopWidth: 1, borderColor: colors.line }]}>
              <View style={[styles.cell, styles.systemCell, { borderColor: colors.line }]}>
                <Text style={[styles.system, { color: colors.ink }]}>{anchor.system}</Text>
              </View>
              <View style={[styles.cell, { borderColor: colors.line }]}>
                <Text style={[styles.body, { color: colors.ink }]}>{anchor.unit}</Text>
              </View>
              <View style={[styles.cell, styles.estimateCell, { borderColor: colors.line }]}>
                <Text style={[styles.body, { color: colors.ink }]}>{anchor.estimate}</Text>
              </View>
              <View style={[styles.cell, styles.riskCell, { borderColor: colors.line }]}>
                <Text style={[styles.body, { color: colors.ink }]}>{anchor.risk}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderRadius: 10,
    marginTop: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  title: {
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 8,
  },
  table: {
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
  },
  cell: {
    minWidth: 118,
    maxWidth: 178,
    paddingVertical: 8,
    paddingHorizontal: 9,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  systemCell: {
    minWidth: 130,
  },
  estimateCell: {
    minWidth: 166,
  },
  riskCell: {
    minWidth: 170,
  },
  header: {
    fontSize: 12,
    fontWeight: '800',
  },
  system: {
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  body: {
    fontSize: 12.5,
    lineHeight: 18,
  },
});
