import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '../theme';
import type { FlagKey } from '../types';

const FLAG_LABEL: Record<FlagKey, string> = {
  term: '术语看不懂',
  hard: '太难',
  easy: '太简单',
  more: '解释不够',
  wrong: '可能有错',
};

export interface FeedbackBlockProps {
  flags: FlagKey[];
  term: string;
  note: string;
  onToggleFlag: (f: FlagKey) => void;
  onTerm: (v: string) => void;
  onNote: (v: string) => void;
}

/** Per-card feedback capture — the seed of the Mode-2 (feedback → cards) generation loop. */
export function FeedbackBlock({ flags, term, note, onToggleFlag, onTerm, onNote }: FeedbackBlockProps) {
  const { colors } = useTheme();
  const inputStyle = {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 9,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginTop: 8,
    fontSize: 14,
    color: colors.ink,
    backgroundColor: colors.card,
  };
  return (
    <View style={[styles.wrap, { borderTopColor: colors.line }]}>
      <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 8 }}>
        卡住 / 有问题？（会进反馈，用来批量生成新卡）
      </Text>
      <View style={styles.chips}>
        {(Object.keys(FLAG_LABEL) as FlagKey[]).map((f) => {
          const on = flags.includes(f);
          return (
            <Pressable
              key={f}
              onPress={() => onToggleFlag(f)}
              style={[
                styles.chip,
                {
                  borderColor: on ? colors.accent : colors.line,
                  backgroundColor: on ? colors.accentSoft : 'transparent',
                },
              ]}
            >
              <Text style={{ fontSize: 13, color: on ? colors.accent : colors.muted }}>
                {FLAG_LABEL[f]}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {flags.includes('term') ? (
        <TextInput
          value={term}
          onChangeText={onTerm}
          placeholder="哪个词看不懂？如 wide-column / 宽列"
          placeholderTextColor={colors.muted}
          style={inputStyle}
        />
      ) : null}
      <TextInput
        value={note}
        onChangeText={onNote}
        placeholder="想补充的（可选）"
        placeholderTextColor={colors.muted}
        style={inputStyle}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 14, borderTopWidth: 1, paddingTop: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { borderWidth: 1.5, borderRadius: 99, paddingVertical: 6, paddingHorizontal: 11 },
});
