import React from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { MONO, useTheme } from '../theme';
import type { Card } from '../types';

export const ATOM_TYPE_LABEL: Record<Card['atomType'], string> = {
  fact: '事实 fact',
  fit: '适配 fit',
  contrast: '对比 contrast',
  consequence: '代价 consequence',
  number: '数量 number',
};

export function TagRow({ card }: { card: Card }) {
  const { colors } = useTheme();
  const base = {
    fontSize: 11,
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: 99,
    overflow: 'hidden' as const,
    letterSpacing: 0.2,
  };
  return (
    <View style={styles.tagRow}>
      <Text style={[base, { backgroundColor: colors.tealBg, color: colors.tealInk }]}>
        {ATOM_TYPE_LABEL[card.atomType]}
      </Text>
      <Text style={[base, { backgroundColor: colors.chip, color: colors.muted }]}>{card.format}</Text>
      <Text style={[base, { backgroundColor: colors.chip, color: colors.muted }]}>{card.sub}</Text>
      <Text style={[base, { backgroundColor: colors.chip, color: colors.muted }]}>{card.id}</Text>
    </View>
  );
}

export function ScenarioBox({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.scenario, { backgroundColor: colors.chip }]}>
      <Text style={[styles.scenarioLabel, { color: colors.muted }]}>SCENARIO 场景</Text>
      <Text style={{ color: colors.ink, fontSize: 14, lineHeight: 21 }}>{text}</Text>
    </View>
  );
}

export function ProgressBar({ ratio }: { ratio: number }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.bar, { backgroundColor: colors.line }]}>
      <View
        style={[
          styles.barFill,
          { backgroundColor: colors.accent, width: `${Math.min(100, Math.max(0, ratio * 100))}%` },
        ]}
      />
    </View>
  );
}

export function CodeBlock({ code, label }: { code: string; label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.codeBox, { backgroundColor: colors.codeBg, borderColor: colors.codeBorder }]}>
      {label ? <Text style={[styles.codeLabel, { color: colors.codeLabel }]}>{label}</Text> : null}
      <Text style={{ color: colors.codeInk, fontFamily: MONO, fontSize: 12.5, lineHeight: 20 }}>
        {code}
      </Text>
    </View>
  );
}

export function ActButton({
  label,
  onPress,
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.actBtn,
        { backgroundColor: colors.accent, opacity: disabled ? 0.4 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      <Text style={{ color: '#fff', fontWeight: '600', fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}

export function GhostButton({
  label,
  onPress,
  style,
}: {
  label: string;
  onPress: () => void;
  style?: ViewStyle;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.ghostBtn,
        { borderColor: pressed ? colors.accent : colors.line },
        style,
      ]}
    >
      <Text style={{ color: colors.ink, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  scenario: { borderRadius: 10, paddingVertical: 11, paddingHorizontal: 13, marginBottom: 14 },
  scenarioLabel: {
    fontWeight: '600',
    fontSize: 11,
    letterSpacing: 0.6,
    marginBottom: 3,
  },
  bar: { height: 5, borderRadius: 99, overflow: 'hidden' },
  barFill: { height: '100%' },
  codeBox: { borderRadius: 10, borderWidth: 1, padding: 12, marginTop: 12 },
  codeLabel: { fontSize: 12, marginBottom: 6 },
  actBtn: {
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostBtn: {
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
