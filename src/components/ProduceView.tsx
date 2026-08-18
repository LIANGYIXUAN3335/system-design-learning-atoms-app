import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme';
import { ActButton } from './ui';

export interface ProduceViewProps {
  /** 翻面后逐条打勾的验收清单 */
  checklist: string[];
  checklistEn?: string[];
  /** 已打勾的条目下标 */
  checked: Set<number>;
  revealed: boolean;
  onReveal: () => void;
  onToggle: (i: number) => void;
}

/**
 * produce 卡（先写后揭晓，2026-10-16）：
 * 题面阶段只给一句提示 + 一个「我写好了」按钮——她在纸上写 schema / endpoint / 组件图 / 状态机；
 * 翻面后清单逐条打勾（人工自查，她 10/11 拍板不做自动判分），参考答案在下面的 RevealBlock 里。
 * 打了几勾只在这一屏上看，最后的成绩仍是「忘了 / 模糊 / 记得」。
 */
export function ProduceView({ checklist, checklistEn, checked, revealed, onReveal, onToggle }: ProduceViewProps) {
  const { colors } = useTheme();

  if (!revealed) {
    return (
      <View>
        <View style={[styles.hintBox, { backgroundColor: colors.amberBg }]}>
          <Text style={{ fontSize: 14, lineHeight: 21, color: colors.amberInk }}>
            ✍️ 先在纸上写出来（或打在别处），写完再翻面。翻面后有 {checklist.length} 条验收项逐条对。
          </Text>
        </View>
        <View style={styles.btnRow}>
          <ActButton label="我写好了，对答案" onPress={onReveal} />
        </View>
      </View>
    );
  }

  return (
    <View>
      <Text style={{ fontSize: 13, fontWeight: '700', color: colors.muted, marginBottom: 8 }}>
        ✅ 验收清单 · 对着你写的打勾（{checked.size} / {checklist.length}）
      </Text>
      <View style={{ gap: 8 }}>
        {checklist.map((item, i) => {
          const on = checked.has(i);
          return (
            <Pressable
              key={i}
              onPress={() => onToggle(i)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              style={({ pressed }) => [
                styles.item,
                {
                  borderColor: on ? colors.ok : pressed ? colors.accent : colors.line,
                  backgroundColor: on ? colors.okBg : colors.card,
                },
              ]}
            >
              <View
                style={[
                  styles.box,
                  { borderColor: on ? colors.ok : colors.line, backgroundColor: on ? colors.ok : 'transparent' },
                ]}
              >
                {on ? <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>✓</Text> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14.5, lineHeight: 21, color: colors.ink }}>{item}</Text>
                {checklistEn?.[i] ? (
                  <Text style={{ fontSize: 12, lineHeight: 17, color: colors.muted, marginTop: 2 }}>
                    {checklistEn[i]}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hintBox: { borderRadius: 10, paddingVertical: 11, paddingHorizontal: 13 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  box: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
});
