import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { buildArchitectureVisual } from '../logic/architectureVisuals';
import { useTheme } from '../theme';
import type { Card } from '../types';
import { MermaidView } from './MermaidView';
import { CodeBlock } from './ui';

export function AutoArchitectureVisual({ card }: { card: Card }) {
  const { colors } = useTheme();
  const visual = useMemo(() => buildArchitectureVisual(card), [card]);

  if (!visual) return null;

  return (
    <View style={[styles.wrap, { borderColor: colors.line, backgroundColor: colors.card }]}>
      <View style={styles.titleRow}>
        <Text style={[styles.title, { color: colors.ink }]}>{visual.title}</Text>
        <Text style={[styles.badge, { color: colors.muted, backgroundColor: colors.chip }]}>auto</Text>
      </View>
      <Text style={[styles.titleEn, { color: colors.muted }]}>{visual.titleEn}</Text>
      <MermaidView spec={visual.diagram} />
      <View style={styles.bullets}>
        {visual.bullets.map((bullet) => (
          <Text key={bullet} style={[styles.bullet, { color: colors.ink }]}>
            • {bullet}
          </Text>
        ))}
      </View>
      {visual.codeSample ? <CodeBlock code={visual.codeSample} label={visual.codeLabel} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 13,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  titleRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 21,
  },
  badge: {
    overflow: 'hidden',
    borderRadius: 99,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 11,
    fontWeight: '700',
  },
  titleEn: {
    marginTop: 2,
    fontSize: 12.5,
    lineHeight: 18,
  },
  bullets: {
    marginTop: 10,
    gap: 5,
  },
  bullet: {
    fontSize: 13.5,
    lineHeight: 20,
  },
});
