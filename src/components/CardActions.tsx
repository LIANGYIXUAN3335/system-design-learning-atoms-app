import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '../theme';

export type CardActionReceipt = 'cloud' | 'local';

export interface CardActionsProps {
  cardId: string;
  onAddSupplement: (title: string, explanation: string) => Promise<CardActionReceipt>;
  onDeleteCard: () => Promise<void>;
}

/** Learner-owned curation controls. They never edit the bundled source deck. */
export function CardActions({ cardId, onAddSupplement, onDeleteCard }: CardActionsProps) {
  const { colors } = useTheme();
  const [mode, setMode] = useState<'closed' | 'add' | 'confirm-delete'>('closed');
  const [title, setTitle] = useState('');
  const [explanation, setExplanation] = useState('');
  const [saving, setSaving] = useState(false);
  const [receipt, setReceipt] = useState<CardActionReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMode('closed');
    setTitle('');
    setExplanation('');
    setSaving(false);
    setReceipt(null);
    setError(null);
  }, [cardId]);

  const addReady = !saving && title.trim().length > 0 && explanation.trim().length > 0;
  const add = async () => {
    if (!addReady) return;
    setSaving(true);
    setError(null);
    try {
      const result = await onAddSupplement(title, explanation);
      setReceipt(result);
      setTitle('');
      setExplanation('');
    } catch {
      setError('这次没有保存成功，请再试一次。');
    } finally {
      setSaving(false);
    }
  };

  const deleteCard = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onDeleteCard();
    } catch {
      setSaving(false);
      setError('这次没有移除成功，请再试一次。');
    }
  };

  const inputStyle = [
    styles.input,
    { borderColor: colors.line, backgroundColor: colors.card, color: colors.ink },
  ];

  return (
    <View style={[styles.wrap, { borderTopColor: colors.line }]}>
      {mode === 'closed' ? (
        <View style={styles.actionRow}>
          <Pressable
            onPress={() => setMode('add')}
            style={({ pressed }) => [styles.actionButton, { borderColor: pressed ? colors.accent : colors.line }]}
          >
            <Text style={{ color: colors.ink, fontSize: 13, fontWeight: '700' }}>＋ 补充知识点</Text>
          </Pressable>
          <Pressable onPress={() => setMode('confirm-delete')} hitSlop={8}>
            <Text style={{ color: colors.bad, fontSize: 13, fontWeight: '700' }}>删除本卡</Text>
          </Pressable>
        </View>
      ) : null}

      {mode === 'add' ? (
        <>
          <Text style={{ color: colors.ink, fontSize: 14, fontWeight: '700' }}>补一张具体的知识点卡</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="知识点，例如：Nginx 和反向代理的关系"
            placeholderTextColor={colors.muted}
            style={inputStyle}
          />
          <TextInput
            value={explanation}
            onChangeText={setExplanation}
            multiline
            placeholder="写下定义、什么时候用，以及一个例子或边界"
            placeholderTextColor={colors.muted}
            style={[inputStyle, styles.explanationInput]}
          />
          <View style={styles.actionRow}>
            <Pressable
              onPress={add}
              disabled={!addReady}
              style={[styles.primaryButton, { backgroundColor: addReady ? colors.accent : colors.line }]}
            >
              <Text style={{ color: addReady ? '#fff' : colors.muted, fontSize: 13, fontWeight: '700' }}>
                {saving ? '加入中…' : '加入个人题库'}
              </Text>
            </Pressable>
            <Pressable onPress={() => setMode('closed')} hitSlop={8} disabled={saving}>
              <Text style={{ color: colors.muted, fontSize: 13 }}>收起</Text>
            </Pressable>
          </View>
          {receipt === 'cloud' ? (
            <Text style={{ color: colors.tealInk, fontSize: 13, marginTop: 9 }}>已加入并同步。回到首页后，它会跟在这张卡后面。</Text>
          ) : null}
          {receipt === 'local' ? (
            <Text style={{ color: colors.amberInk, fontSize: 13, marginTop: 9 }}>已加入本机；同步恢复后会自动上传。</Text>
          ) : null}
        </>
      ) : null}

      {mode === 'confirm-delete' ? (
        <>
          <Text style={{ color: colors.ink, fontSize: 14, fontWeight: '700' }}>从我的题库移除这张卡？</Text>
          <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 5 }}>
            它不会再出现在你的队列或路线图里，原始题库不会被改动。
          </Text>
          <View style={styles.actionRow}>
            <Pressable
              onPress={deleteCard}
              disabled={saving}
              style={[styles.primaryButton, { backgroundColor: saving ? colors.line : colors.bad }]}
            >
              <Text style={{ color: saving ? colors.muted : '#fff', fontSize: 13, fontWeight: '700' }}>
                {saving ? '移除中…' : '确认移除'}
              </Text>
            </Pressable>
            <Pressable onPress={() => setMode('closed')} hitSlop={8} disabled={saving}>
              <Text style={{ color: colors.muted, fontSize: 13 }}>取消</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {error ? <Text style={{ color: colors.bad, fontSize: 13, marginTop: 9 }}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 14, borderTopWidth: 1, paddingTop: 12 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 13, marginTop: 9 },
  actionButton: { borderWidth: 1.5, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 11 },
  primaryButton: { borderRadius: 8, paddingVertical: 9, paddingHorizontal: 13 },
  input: { borderWidth: 1.5, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 10, marginTop: 9, fontSize: 14 },
  explanationInput: { minHeight: 76, textAlignVertical: 'top' },
});
