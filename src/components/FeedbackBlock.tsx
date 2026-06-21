import React, { useEffect, useState } from 'react';
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

export type FeedbackReceipt = 'cloud' | 'local';

export interface FeedbackBlockProps {
  cardId: string;
  flags: FlagKey[];
  term: string;
  note: string;
  /** 这张卡之前已经发过一次（本次会话内） */
  submitted: boolean;
  onToggleFlag: (f: FlagKey) => void;
  onTerm: (v: string) => void;
  onNote: (v: string) => void;
  /** 发给 Claude 改：存本机 + 立刻上云。回 'cloud' = 已上云，'local' = 只存在本机 */
  onSubmit: () => Promise<FeedbackReceipt>;
}

/**
 * 「✏️ 改这张卡」入口（2026-10-13 她拍板）。
 * 不是问卷：她写一句想让这张卡变成什么样 → 发出去 → 每晚 23:40 feedback-loop 让 Claude 只改这一张 →
 * 改成功自动重建卡包 + 部署网页版，第二天刷新就是新卡。
 * 五个快捷词只是省打字；真正送去改的是那句话。没写字又没点「可能有错 / 解释不够」就发不出去。
 */
export function FeedbackBlock({ cardId, flags, term, note, submitted, onToggleFlag, onTerm, onNote, onSubmit }: FeedbackBlockProps) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'idle' | 'sending' | FeedbackReceipt>('idle');

  useEffect(() => {
    setOpen(false);
    setState('idle');
  }, [cardId]);

  const strong = flags.includes('wrong') || flags.includes('more');
  const canSend = state !== 'sending' && (note.trim().length > 0 || strong);

  const send = async () => {
    if (!canSend) return;
    setState('sending');
    const r = await onSubmit();
    setState(r);
  };

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

  if (!open) {
    return (
      <View style={[styles.wrap, { borderTopColor: colors.line }]}>
        <Pressable
          onPress={() => setOpen(true)}
          hitSlop={6}
          style={({ pressed }) => [styles.entry, { borderColor: pressed ? colors.accent : colors.line }]}
        >
          <Text style={{ fontSize: 14, color: colors.ink, fontWeight: '600' }}>
            ✏️ 改这张卡{submitted ? '（已发过一次）' : ''}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, { borderTopColor: colors.line }]}>
      <Text style={{ fontSize: 14, fontWeight: '600', color: colors.ink, marginBottom: 8 }}>
        你想让这张卡变成什么样？
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
        multiline
        placeholder="比如：解释太长，压成三行 / 选项 B 和 C 看不出区别 / 加一个代码例子"
        placeholderTextColor={colors.muted}
        style={[inputStyle, { minHeight: 64, textAlignVertical: 'top' }]}
      />
      <View style={styles.sendRow}>
        <Pressable
          onPress={send}
          disabled={!canSend}
          style={[styles.sendBtn, { backgroundColor: canSend ? colors.accent : colors.line }]}
        >
          <Text style={{ color: canSend ? '#fff' : colors.muted, fontSize: 14, fontWeight: '700' }}>
            {state === 'sending' ? '发送中…' : '发给 Claude 改'}
          </Text>
        </Pressable>
        <Pressable onPress={() => setOpen(false)} hitSlop={8}>
          <Text style={{ color: colors.muted, fontSize: 13 }}>收起</Text>
        </Pressable>
      </View>
      {state === 'cloud' ? (
        <Text style={{ fontSize: 13, color: colors.tealInk, marginTop: 8 }}>
          ✅ 收到。今晚 23:40 Claude 改这张卡，明早刷新能看到。
        </Text>
      ) : null}
      {state === 'local' ? (
        <Text style={{ fontSize: 13, color: colors.amberInk, marginTop: 8 }}>
          已存在本机；这台设备还没连上同步，连上后会自动送出去。
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 14, borderTopWidth: 1, paddingTop: 12 },
  entry: { alignSelf: 'flex-start', borderWidth: 1.5, borderRadius: 99, paddingVertical: 7, paddingHorizontal: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { borderWidth: 1.5, borderRadius: 99, paddingVertical: 6, paddingHorizontal: 11 },
  sendRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10 },
  sendBtn: { borderRadius: 9, paddingVertical: 9, paddingHorizontal: 16 },
});
