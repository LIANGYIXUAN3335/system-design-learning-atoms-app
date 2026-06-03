import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useTheme } from '../theme';
import type { SelectPickerProps } from './SelectPicker';

export type { SelectPickerProps } from './SelectPicker';

/**
 * 下拉筛选器 · iOS/Android 实现。
 *
 * RN 没有原生 `<select>`。用「一行当前值 → 弹一张底部单子」而不是就地展开一片胶囊：
 * 就地展开会把下面整个库往下推一屏，她一边找一边被推走。弹层覆盖在上面，关掉就回到原位。
 */
export function SelectPicker({ label, value, options, allLabel, onChange }: SelectPickerProps) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 150 }}>
      <Pressable
        onPress={() => setOpen(true)}
        style={{
          borderWidth: 1,
          borderRadius: 8,
          paddingVertical: 8,
          paddingHorizontal: 11,
          borderColor: value ? colors.accent : colors.line,
          backgroundColor: value ? colors.accentSoft : colors.card,
        }}
      >
        <Text style={{ fontSize: 13, color: value ? colors.accent : colors.muted }}>
          {value || allLabel} ▾
        </Text>
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable
          onPress={() => setOpen(false)}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              maxHeight: '70%',
              backgroundColor: colors.card,
              borderTopLeftRadius: 14,
              borderTopRightRadius: 14,
              paddingTop: 12,
              paddingBottom: 24,
            }}
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: '600',
                color: colors.muted,
                paddingHorizontal: 16,
                marginBottom: 6,
              }}
            >
              {label}
            </Text>
            <ScrollView>
              {['', ...options].map((o) => {
                const on = o === value;
                return (
                  <Pressable
                    key={o || '__all__'}
                    onPress={() => pick(o)}
                    style={{
                      paddingVertical: 12,
                      paddingHorizontal: 16,
                      backgroundColor: on ? colors.accentSoft : 'transparent',
                    }}
                  >
                    <Text style={{ fontSize: 15, color: on ? colors.accent : colors.ink }}>
                      {on ? '✓ ' : '   '}
                      {o || allLabel}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
