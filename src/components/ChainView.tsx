import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme';

export interface ChainViewProps {
  /** steps in DISPLAY order */
  steps: string[];
  /** maps display index -> original (authored) index */
  toOriginal: number[];
  /** original indexes in the order the user picked them */
  pickedOriginal: number[];
  revealed: boolean;
  /** authored correct order (original indexes) — used to number steps after reveal */
  answerOrder: number[];
  wasCorrect: boolean | null;
  onPick: (displayIndex: number) => void;
  onReset: () => void;
}

/**
 * Tap-in-order chain input (需求 → 选型 → 代价 → 缓解).
 * After a wrong answer or 不确定, each step shows its CORRECT position number
 * in ok-green (prototype parity).
 */
export function ChainView({
  steps,
  toOriginal,
  pickedOriginal,
  revealed,
  answerOrder,
  wasCorrect,
  onPick,
  onReset,
}: ChainViewProps) {
  const { colors } = useTheme();
  const showCorrect = revealed && wasCorrect !== true;
  return (
    <View>
      <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 10 }}>
        按顺序点击（需求 → 选型 → 代价 → 缓解）
      </Text>
      <View style={{ gap: 9 }}>
        {steps.map((step, k) => {
          const orig = toOriginal[k];
          const pickedPos = pickedOriginal.indexOf(orig); // -1 if not picked
          const correctPos = answerOrder.indexOf(orig);
          let number = pickedPos >= 0 ? String(pickedPos + 1) : '';
          let borderColor = pickedPos >= 0 ? colors.accent : colors.line;
          let circleBg = pickedPos >= 0 ? colors.accent : colors.chip;
          let circleColor = pickedPos >= 0 ? '#fff' : colors.muted;
          if (showCorrect) {
            number = String(correctPos + 1);
            borderColor = colors.ok;
            circleBg = colors.okBg;
            circleColor = colors.ok;
          }
          return (
            <Pressable
              key={k}
              disabled={revealed || pickedPos >= 0}
              onPress={() => onPick(k)}
              style={[styles.step, { borderColor, backgroundColor: colors.card }]}
            >
              <View style={[styles.circle, { backgroundColor: circleBg }]}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: circleColor }}>{number}</Text>
              </View>
              <Text style={{ color: colors.ink, fontSize: 15, lineHeight: 22, flex: 1 }}>{step}</Text>
            </Pressable>
          );
        })}
      </View>
      {!revealed && pickedOriginal.length > 0 ? (
        <Pressable onPress={onReset} style={{ marginTop: 10, alignSelf: 'flex-start' }}>
          <Text style={{ color: colors.muted, fontSize: 13 }}>↺ 重选</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  step: {
    flexDirection: 'row',
    gap: 11,
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 11,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  circle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
