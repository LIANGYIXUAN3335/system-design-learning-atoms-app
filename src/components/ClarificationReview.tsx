import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { createCopilotRequestId, reviewClarifications, type ClarificationFinding, type ClarificationReviewResult } from '../copilot/api';
import { useTheme } from '../theme';
import type { ClarificationReviewSpec } from '../types';
import { ActButton } from './ui';

function draftKey(cardId: string): string {
  return `atoms.copilot.clarification-draft.${cardId}`;
}

function loadDraft(cardId: string): string {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(draftKey(cardId)) ?? '';
  } catch {
    return '';
  }
}

function saveDraft(cardId: string, value: string): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(draftKey(cardId), value);
  } catch {
    // A private/incognito browser may deny local storage. The current session still works.
  }
}

function FindingList({ title, items, tone }: { title: string; items: ClarificationFinding[]; tone: 'ok' | 'warn' | 'muted' }) {
  const { colors } = useTheme();
  if (!items.length) return null;
  const palette = tone === 'ok'
    ? { bg: colors.okBg, ink: colors.ok }
    : tone === 'warn'
      ? { bg: colors.amberBg, ink: colors.amberInk }
      : { bg: colors.chip, ink: colors.ink };
  return (
    <View style={[styles.resultBox, { backgroundColor: palette.bg }]}> 
      <Text style={{ color: palette.ink, fontSize: 13, fontWeight: '700', marginBottom: 5 }}>{title}</Text>
      {items.map((item) => (
        <View key={`${title}-${item.id}`} style={styles.finding}>
          <Text style={{ color: palette.ink, fontSize: 14, fontWeight: '700' }}>{item.label}</Text>
          {item.evidence ? <Text style={{ color: palette.ink, fontSize: 13, lineHeight: 19 }}>你写了：{item.evidence}</Text> : null}
          {item.ask ? <Text style={{ color: palette.ink, fontSize: 13, lineHeight: 19 }}>补问：{item.ask}</Text> : null}
          <Text style={{ color: palette.ink, fontSize: 13, lineHeight: 19 }}>{item.why}</Text>
        </View>
      ))}
    </View>
  );
}

export function ClarificationReview({ cardId, spec }: { cardId: string; spec: ClarificationReviewSpec }) {
  const { colors } = useTheme();
  const [answer, setAnswer] = useState(() => loadDraft(cardId));
  const [review, setReview] = useState<ClarificationReviewResult | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'stale'>('idle');
  const [message, setMessage] = useState('');
  const revisionRef = useRef(0);
  const requestRef = useRef<{ revision: number; id: string } | null>(null);

  useEffect(() => {
    setAnswer(loadDraft(cardId));
    setReview(null);
    setState('idle');
    setMessage('');
    revisionRef.current = 0;
    requestRef.current = null;
  }, [cardId]);

  const changeAnswer = (value: string) => {
    revisionRef.current += 1;
    requestRef.current = null;
    setAnswer(value);
    setReview(null);
    setState('idle');
    setMessage('');
    saveDraft(cardId, value);
  };

  const runReview = async () => {
    const trimmed = answer.trim();
    if (!trimmed) {
      setState('error');
      setMessage('先贴上你实际问过的澄清问题。');
      return;
    }
    if (trimmed.length > spec.maxChars) {
      setState('error');
      setMessage(`这段超过 ${spec.maxChars} 字，先压成实际说出口的版本。`);
      return;
    }
    const revision = revisionRef.current;
    const existing = requestRef.current;
    const requestId = existing?.revision === revision ? existing.id : createCopilotRequestId();
    // Keep the id before waiting. A network retry can then retrieve a completed
    // review instead of paying for a second model call.
    requestRef.current = { revision, id: requestId };
    setState('loading');
    setMessage('Copilot 正在按澄清线审稿…');
    try {
      const result = await reviewClarifications({
        cardId,
        rubricVersion: spec.version,
        answer: trimmed,
        requestId,
      });
      if (revisionRef.current !== revision) {
        setState('stale');
        setMessage('你已经改过草稿；上一版审稿没有贴到新版本上。');
        return;
      }
      requestRef.current = { revision, id: result.requestId };
      setReview(result);
      setState('idle');
      setMessage('审稿完成。');
    } catch (error) {
      if (revisionRef.current !== revision) return;
      const safe = error instanceof Error ? error.message : 'Copilot 暂时不可用；草稿和人工清单都还在。';
      setState('error');
      setMessage(safe);
    }
  };

  const canReview = state !== 'loading' && Boolean(answer.trim());
  const inputStyle = {
    borderColor: colors.line,
    backgroundColor: colors.card,
    color: colors.ink,
  };

  return (
    <View style={[styles.wrap, { borderTopColor: colors.line }]}> 
      <Text style={{ color: colors.ink, fontSize: 14, fontWeight: '700' }}>Copilot 审澄清</Text>
      <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 4 }}>{spec.prompt}</Text>
      <TextInput
        value={answer}
        onChangeText={changeAnswer}
        multiline
        textAlignVertical="top"
        accessibilityLabel="输入你实际问过的澄清问题"
        accessibilityHint="点击 Copilot 审澄清后，按这道题的需求评分线获得反馈"
        placeholder="例如：三天是固定 UTC 窗口吗？付款在截止后成功是否算？"
        placeholderTextColor={colors.muted}
        style={[styles.input, inputStyle]}
      />
      <Text style={{ color: colors.muted, fontSize: 12, marginTop: 5 }}>{answer.length} / {spec.maxChars}</Text>
      <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 7 }}>
        发送后会交给你的 Copilot 审一次；草稿只留在这台浏览器。
      </Text>
      <View style={styles.actionRow}>
        <ActButton label={state === 'loading' ? '审稿中…' : 'Copilot 审澄清'} onPress={runReview} disabled={!canReview} />
        {answer ? (
          <Pressable onPress={() => changeAnswer('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="清空澄清草稿">
            <Text style={{ color: colors.muted, fontSize: 13 }}>清空</Text>
          </Pressable>
        ) : null}
      </View>
      {message ? (
        <Text accessibilityLiveRegion="polite" style={{ color: state === 'error' ? colors.amberInk : colors.muted, fontSize: 13, lineHeight: 19, marginTop: 9 }}>
          {message}
        </Text>
      ) : null}
      {review ? (
        <View accessibilityLiveRegion="polite" style={{ marginTop: 12 }}>
          <Text style={{ color: colors.ink, fontSize: 14, lineHeight: 20, marginBottom: 8 }}>{review.summary}</Text>
          <FindingList title="问得好" items={review.covered} tone="ok" />
          <FindingList title="还要问" items={review.missed} tone="warn" />
          <FindingList title="这轮先别问" items={review.lowValue} tone="muted" />
          <FindingList title="默认假设还没锁定" items={review.riskyAssumptions} tone="warn" />
          <View style={[styles.scopeLine, { borderColor: colors.amberInk, backgroundColor: colors.amberBg }]}>
            <Text style={{ color: colors.amberInk, fontSize: 13, fontWeight: '700', marginBottom: 4 }}>下一问</Text>
            <Text style={{ color: colors.amberInk, fontSize: 14, lineHeight: 21 }}>{review.nextQuestion}</Text>
          </View>
          <View style={[styles.scopeLine, { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}>
            <Text style={{ color: colors.ink, fontSize: 13, fontWeight: '700', marginBottom: 4 }}>接下来可以这样锁范围</Text>
            <Text style={{ color: colors.ink, fontSize: 14, lineHeight: 21 }}>{review.scopeLine}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 16, borderTopWidth: 1, paddingTop: 14 },
  input: { borderWidth: 1.5, borderRadius: 9, paddingVertical: 9, paddingHorizontal: 10, marginTop: 9, minHeight: 116, fontSize: 14, lineHeight: 20 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10 },
  resultBox: { borderRadius: 9, padding: 11, marginTop: 8 },
  finding: { gap: 3, marginTop: 7 },
  scopeLine: { borderWidth: 1, borderRadius: 9, padding: 11, marginTop: 8 },
});
