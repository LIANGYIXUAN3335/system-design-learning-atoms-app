import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Speech from 'expo-speech';
import { TTS_LANGUAGE, TTS_RATE } from '../config';
import { useTheme } from '../theme';
import type { Card, FlagKey, SelfGrade } from '../types';
import { AnswerDetailPad, type AnswerOptionDetail } from './AnswerDetailPad';
import { AutoArchitectureVisual } from './AutoArchitectureVisual';
import { CodeBlock } from './ui';
import { FeedbackBlock } from './FeedbackBlock';
import { CardActions, type CardActionReceipt } from './CardActions';
import { MermaidView } from './MermaidView';
import { NumberAnchors } from './NumberAnchors';
import { TableView } from './TableView';
import { TermGlossary } from './TermGlossary';

export type Verdict = 'correct' | 'wrong' | 'idk' | 'shown' | 'produced';

const VERDICT_TEXT: Record<Verdict, string> = {
  correct: '✓ 正确',
  wrong: '✗ 再看解释',
  idk: '🤔 不确定 — 已记下',
  shown: '答案已揭示',
  produced: '✍️ 对着参考答案打勾，再自评',
};

export interface RevealBlockProps {
  card: Card;
  verdict: Verdict;
  flags: FlagKey[];
  term: string;
  note: string;
  onToggleFlag: (f: FlagKey) => void;
  onTerm: (v: string) => void;
  onNote: (v: string) => void;
  feedbackSubmitted: boolean;
  onSubmitFeedback: () => Promise<'cloud' | 'local'>;
  onAddSupplement: (title: string, explanation: string) => Promise<CardActionReceipt>;
  onDeleteCard: () => Promise<void>;
  onGrade: (g: SelfGrade) => void;
  optionDetails?: AnswerOptionDetail[];
  panel?: boolean;
  /** A1：答对且比她平时快时的一行「⚡ 5 秒」；慢了 / 答错时为空，什么都不显示 */
  speedNote?: string | null;
}

function speakEnglish(text: string) {
  Speech.stop();
  Speech.speak(text, { language: TTS_LANGUAGE, rate: TTS_RATE });
}

/** Post-answer block: verdict → why → visual atoms → codeSample → English + 🔊 → whenOtherWins → glossary → feedback → self-grade. */
export function RevealBlock(props: RevealBlockProps) {
  const { card, verdict } = props;
  const { colors } = useTheme();
  const verdictColor =
    verdict === 'correct' ? colors.ok : verdict === 'wrong' ? colors.bad : colors.ink;

  return (
    <View style={[styles.wrap, { borderTopColor: colors.line }, props.panel ? styles.panelWrap : null]}>
      <Text style={{ fontSize: 15, fontWeight: '700', color: verdictColor, marginBottom: 9 }}>
        {VERDICT_TEXT[verdict]}
        {verdict === 'correct' && props.speedNote ? (
          <Text style={{ fontSize: 13, fontWeight: '600', color: colors.muted }}>{'   '}{props.speedNote}</Text>
        ) : null}
      </Text>
      <Text style={{ fontSize: 15, lineHeight: 23, color: colors.ink }}>{card.why}</Text>

      <AnswerDetailPad details={props.optionDetails ?? []} />

      <NumberAnchors anchors={card.numberAnchors} />

      {card.diagram ? <MermaidView spec={card.diagram} /> : null}

      {card.table ? (
        <View style={{ marginTop: 14 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: colors.muted, marginBottom: -6 }}>
            ⚖️ 横向对比
          </Text>
          <TableView table={card.table} />
        </View>
      ) : null}

      {card.codeSample ? (
        <CodeBlock
          code={card.codeSample}
          label={card.format === 'produce' ? '参考答案' : `实现参考${card.lang ? ' · ' + card.lang : ''}`}
        />
      ) : null}

      {!card.diagram ? <AutoArchitectureVisual card={card} /> : null}

      {card.why_en ? (
        <View style={[styles.enBox, { backgroundColor: colors.tealBg }]}>
          <Text style={{ fontSize: 12, color: colors.tealInk, opacity: 0.85, marginBottom: 8 }}>
            English restatement 英文复述
          </Text>
          <View style={{ flexDirection: 'row', gap: 11, alignItems: 'flex-start' }}>
            <Pressable
              onPress={() => speakEnglish(card.why_en)}
              style={[styles.speakBtn, { backgroundColor: colors.tealInk }]}
            >
              <Text style={{ color: colors.tealBg, fontSize: 13, fontWeight: '600' }}>🔊 朗读</Text>
            </Pressable>
            <Text style={{ flex: 1, fontSize: 14, lineHeight: 21, color: colors.tealInk }}>
              {card.why_en}
            </Text>
          </View>
        </View>
      ) : null}

      {card.whenOtherWins ? (
        <View style={[styles.otherBox, { backgroundColor: colors.amberBg }]}>
          <Text style={{ fontSize: 14, lineHeight: 21, color: colors.amberInk }}>
            <Text style={{ fontWeight: '600' }}>什么时候选别的：</Text> {card.whenOtherWins}
          </Text>
        </View>
      ) : null}

      {card.references?.length ? (
        <View style={[styles.referenceBox, { borderColor: colors.line, backgroundColor: colors.chip }]}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: colors.muted, marginBottom: 6 }}>资料依据</Text>
          {card.references.map((reference) => (
            <Pressable
              key={reference.url}
              accessibilityRole="link"
              accessibilityLabel={`打开资料：${reference.title}`}
              onPress={() => { void Linking.openURL(reference.url); }}
              style={({ pressed }) => [styles.referenceLink, { opacity: pressed ? 0.68 : 1 }]}
            >
              <Text style={{ fontSize: 13, lineHeight: 19, color: colors.accent, fontWeight: '700' }}>
                {reference.title}
              </Text>
              {reference.note ? (
                <Text style={{ fontSize: 12, lineHeight: 18, color: colors.muted }}>{reference.note}</Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}

      <TermGlossary card={card} />

      <FeedbackBlock
        cardId={card.id}
        submitted={props.feedbackSubmitted}
        onSubmit={props.onSubmitFeedback}
        flags={props.flags}
        term={props.term}
        note={props.note}
        onToggleFlag={props.onToggleFlag}
        onTerm={props.onTerm}
        onNote={props.onNote}
      />

      <CardActions
        cardId={card.id}
        onAddSupplement={props.onAddSupplement}
        onDeleteCard={props.onDeleteCard}
      />

      <View style={styles.gradeRow}>
        {(
          [
            ['forgot', '忘了'],
            ['fuzzy', '模糊'],
            ['got', '记得 ✓'],
          ] as Array<[SelfGrade, string]>
        ).map(([g, label]) => (
          <Pressable
            key={g}
            onPress={() => props.onGrade(g)}
            style={({ pressed }) => [
              styles.gradeBtn,
              { borderColor: pressed ? colors.accent : colors.line },
            ]}
          >
            <Text style={{ color: colors.ink, fontSize: 15 }}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 16, borderTopWidth: 1, paddingTop: 15 },
  panelWrap: { marginTop: 0, borderTopWidth: 0, paddingTop: 0 },
  enBox: { borderRadius: 10, paddingVertical: 11, paddingHorizontal: 13, marginTop: 12 },
  speakBtn: { borderRadius: 8, paddingVertical: 7, paddingHorizontal: 12 },
  otherBox: { borderRadius: 10, paddingVertical: 11, paddingHorizontal: 13, marginTop: 11 },
  referenceBox: { borderWidth: 1, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, marginTop: 11 },
  referenceLink: { paddingVertical: 5 },
  gradeRow: { flexDirection: 'row', gap: 8, marginTop: 15 },
  gradeBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
});
