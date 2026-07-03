import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MONO, useTheme } from '../theme';
import { MermaidView } from './MermaidView';

const LETTERS = 'ABCDEFGH';

export interface OptionListProps {
  /** options in DISPLAY order */
  options: string[];
  /** optional English/helper text in DISPLAY order */
  optionSubtexts?: Array<string | null | undefined>;
  /** display indexes of the correct answers (already remapped) */
  correctDisplay: Set<number>;
  /** display indexes currently selected (multi) */
  selected: Set<number>;
  revealed: boolean;
  /** which display indexes the user actually picked (for wrong-highlight after reveal) */
  picked: Set<number>;
  monospace?: boolean;
  optionDiagrams?: Array<string | null>;
  onPress: (displayIndex: number) => void;
}

export function OptionList({
  options,
  optionSubtexts,
  correctDisplay,
  selected,
  revealed,
  picked,
  monospace,
  optionDiagrams,
  onPress,
}: OptionListProps) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 9 }}>
      {options.map((opt, k) => {
        const subtext = optionSubtexts?.[k]?.trim();
        let borderColor = colors.line;
        let backgroundColor = colors.card;
        if (revealed) {
          if (correctDisplay.has(k)) {
            borderColor = colors.ok;
            backgroundColor = colors.okBg;
          } else if (picked.has(k)) {
            borderColor = colors.bad;
            backgroundColor = colors.badBg;
          }
        } else if (selected.has(k)) {
          borderColor = colors.accent;
          backgroundColor = colors.accentSoft;
        }
        return (
          <Pressable
            key={k}
            disabled={revealed}
            onPress={() => onPress(k)}
            style={[styles.opt, { borderColor, backgroundColor }]}
          >
            <Text style={[styles.key, { color: colors.muted }]}>{LETTERS[k]}</Text>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: colors.ink,
                  fontSize: monospace ? 12.5 : 16,
                  lineHeight: monospace ? 20 : 24,
                  ...(monospace ? { fontFamily: MONO } : null),
                }}
              >
                {opt}
              </Text>
              {subtext ? <Text style={[styles.optionEn, { color: colors.muted }]}>{subtext}</Text> : null}
              {optionDiagrams?.[k] ? <MermaidView spec={optionDiagrams[k]!} /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  opt: {
    flexDirection: 'row',
    gap: 11,
    alignItems: 'flex-start',
    borderWidth: 1.5,
    borderRadius: 11,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  key: { fontWeight: '700', width: 18, fontSize: 16, lineHeight: 24 },
  optionEn: { fontSize: 12.5, lineHeight: 18, marginTop: 3 },
});
