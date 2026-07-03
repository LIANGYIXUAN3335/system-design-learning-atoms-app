import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme';
import type { CardTable } from '../types';

/**
 * Structured-table visual atom ({headers, rows}) — the shape the ag/cr seed
 * cards ship. Display-only (spec §9: build only if trivial; it is).
 */
export function TableView({ table }: { table: CardTable }) {
  const { colors } = useTheme();
  const minCellWidth = 96;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }}>
      <View style={[styles.table, { borderColor: colors.line }]}>
        <View style={[styles.row, { backgroundColor: colors.chip }]}>
          {table.headers.map((h, i) => (
            <View key={i} style={[styles.cell, { borderColor: colors.line, minWidth: minCellWidth }]}>
              <Text style={{ color: colors.muted, fontSize: 12.5, fontWeight: '700' }}>{h}</Text>
            </View>
          ))}
        </View>
        {table.rows.map((row, r) => (
          <View key={r} style={[styles.row, { borderTopWidth: 1, borderColor: colors.line }]}>
            {row.map((cell, c) => (
              <View key={c} style={[styles.cell, { borderColor: colors.line, minWidth: minCellWidth }]}>
                <Text style={{ color: colors.ink, fontSize: 13, lineHeight: 19 }}>{cell}</Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  table: { borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  row: { flexDirection: 'row' },
  cell: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
});
