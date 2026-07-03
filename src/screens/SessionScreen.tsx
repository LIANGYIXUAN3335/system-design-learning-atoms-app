import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { localDateStr } from '../logic/dates';
import { chainCorrect, choiceCorrect, toFeedbackGrade, toFsrsRating } from '../logic/grading';
import { dueAdditions, type SrsEntry } from '../logic/queue';
import { shuffleWithMap, type Shuffled } from '../logic/shuffle';
import { applyReview, emptyCard } from '../logic/srs';
import { logReview, saveFeedback, saveSrs, type Db } from '../db/database';
import { useTheme } from '../theme';
import type { Card, FeedbackRow, FlagKey, SelfGrade } from '../types';
import { ChainView } from '../components/ChainView';
import { ClozeView } from '../components/ClozeView';
import { OptionList } from '../components/OptionList';
import { RevealBlock, type Verdict } from '../components/RevealBlock';
import type { AnswerOptionDetail } from '../components/AnswerDetailPad';
import { ActButton, GhostButton, ProgressBar, ScenarioBox, TagRow } from '../components/ui';

const OPTION_LABELS = 'ABCDEFGH';

export interface SessionStore {
  srs: Map<string, SrsEntry>;
  fb: Map<string, FeedbackRow>;
}

export interface SessionStats {
  answered: number;
  correct: number;
}

interface Ephemeral {
  phase: 'question' | 'revealed';
  verdict: Verdict;
  shuffledOptions: Shuffled<string> | null;
  shuffledSteps: Shuffled<string> | null;
  /** display indexes selected (multi, pre-check) */
  multiSel: Set<number>;
  /** display indexes actually picked (for wrong-highlight after reveal) */
  pickedDisplay: Set<number>;
  /** chain picks in ORIGINAL indexes, in pick order */
  chainPicked: number[];
  wasCorrect: boolean | null;
  usedIdk: boolean;
  flags: FlagKey[];
  term: string;
  note: string;
  startTs: number;
}

function compactText(text: string | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function asSentence(text: string): string {
  const compact = compactText(text);
  if (!compact) return '';
  return /[。.!?！？]$/.test(compact) ? compact : `${compact}。`;
}

function optionIdentityFromLegacy(explanation: string): string {
  const cleaned = compactText(explanation).replace(/^正确[，。:：\s]*/, '');
  const firstClause = cleaned.split(/[。；;]/)[0]?.trim() ?? '';
  if (firstClause.length < 6 || firstClause.length > 72) return '';
  if (!/(是|指|描述|代表|用于|适合|对应|关系)/.test(firstClause)) return '';
  return asSentence(`已有解释把它定位为：${firstClause}`);
}

// Fallback policy (rubric 1.3-F1): empty beats filler. When there's no
// explicit note and no usable legacy text, we show NOTHING for that slot.
// Auto-generated keyword frames read like filler and can be wrong in context.
function optionMeaning(card: Card, originalIndex: number): string {
  const explicit = compactText(card.optionMeanings?.[originalIndex]);
  if (explicit) return explicit;

  const legacyIdentity = optionIdentityFromLegacy(card.optionExplanations?.[originalIndex] ?? '');
  if (legacyIdentity) return legacyIdentity;

  return '';
}

function optionScenarioImpact(card: Card, originalIndex: number): string {
  const explicit = compactText(card.optionScenarioImpacts?.[originalIndex]);
  if (explicit) return explicit;

  return '';
}

function optionFitContext(card: Card, originalIndex: number): string {
  const explicit = compactText(card.optionDirectness?.[originalIndex]);
  if (explicit) return explicit;

  const legacy = compactText(card.optionExplanations?.[originalIndex]);
  if (legacy) return asSentence(legacy);

  // Empty beats filler. We used to auto-generate a "most direct" sentence
  // from `why`, but that duplicated the verdict instead of teaching the
  // option's own applicability boundary.
  return '';
}

// One flowing English sentence-run per option — no "Meaning:/Fit:/Scenario:"
// labels; the zh paragraph above it already carries the structure.
function optionExplanationEn(card: Card, originalIndex: number): string {
  const meaning = compactText(card.optionMeanings_en?.[originalIndex]) || '';
  const fitContext =
    compactText(card.optionDirectness_en?.[originalIndex]) ||
    compactText(card.optionExplanations_en?.[originalIndex]) ||
    '';
  const scenario = compactText(card.optionScenarioImpacts_en?.[originalIndex]) || '';

  return [meaning, fitContext, scenario].filter(Boolean).join(' ');
}

function buildAnswerOptionDetail(
  card: Card,
  label: string,
  text: string,
  originalIndex: number,
  isCorrect: boolean,
  wasPicked: boolean,
): AnswerOptionDetail {
  return {
    label,
    text,
    isCorrect,
    wasPicked,
    meaning: optionMeaning(card, originalIndex),
    fitContext: optionFitContext(card, originalIndex),
    scenarioImpact: optionScenarioImpact(card, originalIndex),
    explanationEn: optionExplanationEn(card, originalIndex),
  };
}

export interface SessionScreenProps {
  db: Db;
  cards: Card[];
  store: SessionStore;
  initialQueue: string[];
  /** requeue-sweep universe for mode-filtered sessions; null/undefined = the whole deck */
  requeueScope?: Set<string> | null;
  onExit: () => void;
  onDone: (stats: SessionStats) => void;
}

export function SessionScreen({
  db,
  cards,
  store,
  initialQueue,
  requeueScope,
  onExit,
  onDone,
}: SessionScreenProps) {
  const { colors } = useTheme();
  const { width, height } = useWindowDimensions();
  const cardsById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const sweepScope = useMemo(
    () => requeueScope ?? new Set(cards.map((c) => c.id)),
    [requeueScope, cards],
  );

  const [queue, setQueue] = useState<string[]>(initialQueue);
  const [pos, setPos] = useState(0);
  const statsRef = useRef<SessionStats>({ answered: 0, correct: 0 });
  const scrollRef = useRef<ScrollView>(null);
  const revealY = useRef(0);

  const card = cardsById.get(queue[pos]);

  const initEphemeral = (c: Card | undefined): Ephemeral => {
    const prevFb = c ? store.fb.get(c.id) : undefined;
    return {
      phase: 'question',
      verdict: 'shown',
      shuffledOptions: c?.options ? shuffleWithMap(c.options) : null,
      shuffledSteps: c?.steps ? shuffleWithMap(c.steps) : null,
      multiSel: new Set(),
      pickedDisplay: new Set(),
      chainPicked: [],
      wasCorrect: null,
      usedIdk: false,
      flags: prevFb ? [...prevFb.flags] : [],
      term: prevFb?.term ?? '',
      note: prevFb?.note ?? '',
      startTs: Date.now(),
    };
  };

  const [eph, setEph] = useState<Ephemeral>(() => initEphemeral(cardsById.get(initialQueue[0])));

  // Defensive: end the session if the queue references a card no longer in the deck.
  useEffect(() => {
    if (!card) onDone(statsRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card]);
  if (!card) return null;

  const persistFeedback = (patch: Partial<FeedbackRow>) => {
    const row: FeedbackRow = {
      cardId: card.id,
      grade: store.fb.get(card.id)?.grade ?? null,
      flags: eph.flags,
      term: eph.term,
      note: eph.note,
      updatedAt: new Date().toISOString(),
      ...patch,
    };
    store.fb.set(card.id, row);
    saveFeedback(db, row).catch((e) => console.warn('saveFeedback failed', e));
  };

  const scrollToReveal = () => {
    setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, revealY.current - 60), animated: true }), 80);
  };

  const reveal = (verdict: Verdict, wasCorrect: boolean | null, usedIdk: boolean, pickedDisplay?: Set<number>) => {
    setEph((e) => ({
      ...e,
      phase: 'revealed',
      verdict,
      wasCorrect,
      usedIdk,
      pickedDisplay: pickedDisplay ?? e.pickedDisplay,
    }));
    scrollToReveal();
  };

  // ---- answer handlers -------------------------------------------------

  const pickChoice = (k: number) => {
    if (eph.phase !== 'question' || !eph.shuffledOptions || !card.answer) return;
    if (card.format === 'multi') {
      setEph((e) => {
        const sel = new Set(e.multiSel);
        if (sel.has(k)) sel.delete(k);
        else sel.add(k);
        return { ...e, multiSel: sel };
      });
      return;
    }
    const orig = eph.shuffledOptions.toOriginal[k];
    const ok = choiceCorrect(card.answer, new Set([orig]));
    reveal(ok ? 'correct' : 'wrong', ok, false, new Set([k]));
  };

  const checkMulti = () => {
    if (eph.phase !== 'question' || !eph.shuffledOptions || !card.answer) return;
    const pickedOriginal = new Set([...eph.multiSel].map((k) => eph.shuffledOptions!.toOriginal[k]));
    const ok = choiceCorrect(card.answer, pickedOriginal);
    reveal(ok ? 'correct' : 'wrong', ok, false, new Set(eph.multiSel));
  };

  const pickStep = (k: number) => {
    if (eph.phase !== 'question' || !eph.shuffledSteps || !card.answerOrder) return;
    const orig = eph.shuffledSteps.toOriginal[k];
    if (eph.chainPicked.includes(orig)) return;
    const picked = [...eph.chainPicked, orig];
    if (picked.length < (card.steps?.length ?? 0)) {
      setEph((e) => ({ ...e, chainPicked: picked }));
      return;
    }
    const ok = chainCorrect(card.answerOrder, card.acceptAltOrders, picked);
    setEph((e) => ({ ...e, chainPicked: picked }));
    reveal(ok ? 'correct' : 'wrong', ok, false);
  };

  const resetChain = () => {
    if (eph.phase !== 'question') return;
    setEph((e) => ({ ...e, chainPicked: [] }));
  };

  const idk = () => {
    if (eph.phase !== 'question') return;
    persistFeedback({ grade: 'unknown' });
    reveal('idk', null, true);
  };

  const revealCloze = () => {
    if (eph.phase !== 'question') return;
    reveal('shown', null, false);
  };

  // ---- grading ---------------------------------------------------------

  const grade = (g: SelfGrade) => {
    const now = new Date();
    const rating = toFsrsRating(g, eph.wasCorrect, eph.usedIdk);
    const existing = store.srs.get(card.id);
    const prev = existing?.fsrs ?? emptyCard(now);
    const entry: SrsEntry = {
      fsrs: applyReview(prev, now, rating),
      firstSeen: existing?.firstSeen ?? localDateStr(now),
    };
    store.srs.set(card.id, entry);
    saveSrs(db, card.id, entry).catch((e) => console.warn('saveSrs failed', e));
    logReview(db, {
      cardId: card.id,
      ts: now,
      day: localDateStr(now),
      rating,
      wasCorrect: eph.wasCorrect,
      usedIdk: eph.usedIdk,
      elapsedMs: Date.now() - eph.startTs,
    }).catch((e) => console.warn('logReview failed', e));
    persistFeedback({ grade: toFeedbackGrade(g) });

    statsRef.current = {
      answered: statsRef.current.answered + 1,
      correct: statsRef.current.correct + (eph.wasCorrect === true ? 1 : 0),
    };

    // Requeue sweep: cards that became due (the just-lapsed card, learning
    // steps maturing) go to the END of the queue — bounded to sweepScope so a
    // mode-filtered session never pulls in cards the user excluded.
    const remaining = new Set(queue.slice(pos + 1));
    const additions = dueAdditions(store.srs, sweepScope, remaining, new Date());
    const nextQueue = additions.length ? [...queue, ...additions] : queue;

    if (pos + 1 >= nextQueue.length) {
      onDone(statsRef.current);
      return;
    }
    setQueue(nextQueue);
    setPos(pos + 1);
    setEph(initEphemeral(cardsById.get(nextQueue[pos + 1])));
    setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: false }), 30);
  };

  // ---- render ----------------------------------------------------------

  // one flag handler + one props object, shared by the inline and side-panel
  // reveal renders so the persistence wiring can't drift between layouts
  const toggleFlag = (f: FlagKey) => {
    const flags = eph.flags.includes(f) ? eph.flags.filter((x) => x !== f) : [...eph.flags, f];
    persistFeedback({ flags });
    setEph((e) => ({ ...e, flags }));
  };

  const remaining = queue.length - pos;
  const { answered } = statsRef.current;
  const isChoice = card.format === 'mcq' || card.format === 'multi' || card.format === 'code';
  const correctDisplay = new Set<number>(
    isChoice && eph.shuffledOptions && card.answer
      ? eph.shuffledOptions.toOriginal
          .map((orig, k) => (card.answer!.includes(orig) ? k : -1))
          .filter((k) => k >= 0)
      : [],
  );
  const optionDiagrams =
    isChoice && eph.shuffledOptions && card.optionDiagrams
      ? eph.shuffledOptions.toOriginal.map((orig) => card.optionDiagrams?.[orig] ?? null)
      : undefined;
  const optionSubtexts =
    isChoice && eph.shuffledOptions && card.options_en
      ? eph.shuffledOptions.toOriginal.map((orig) => card.options_en?.[orig] ?? null)
      : undefined;
  const optionDetails: AnswerOptionDetail[] =
    isChoice && eph.shuffledOptions && card.options && card.answer
      ? eph.shuffledOptions.items.map((text, displayIndex) => {
          const originalIndex = eph.shuffledOptions!.toOriginal[displayIndex];
          const isCorrectOption = card.answer!.includes(originalIndex);
          return buildAnswerOptionDetail(
            card,
            OPTION_LABELS[displayIndex] ?? String(displayIndex + 1),
            text,
            originalIndex,
            isCorrectOption,
            eph.pickedDisplay.has(displayIndex),
          );
        })
      : [];
  const sideReveal = eph.phase === 'revealed' && width >= 920;
  const sidePanelWidth = Math.min(460, Math.max(360, width * 0.36));
  const sidePanelMaxHeight = Math.max(430, height - 136);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Pressable onPress={onExit} hitSlop={10}>
          <Text style={{ color: colors.muted, fontSize: 15 }}>‹ 退出</Text>
        </Pressable>
        <Text style={{ color: colors.muted, fontSize: 13 }}>
          斩杀 {answered} · 剩余 {remaining}
        </Text>
      </View>
      <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
        <ProgressBar ratio={answered / Math.max(1, answered + remaining)} />
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scrollBody, sideReveal ? styles.scrollBodyWide : null]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.studyGrid, sideReveal ? styles.studyGridWide : null]}>
          <View
            style={[
              styles.card,
              sideReveal ? styles.questionPane : null,
              { backgroundColor: colors.card, borderColor: colors.line },
            ]}
          >
            <TagRow card={card} />
            {card.scenario ? <ScenarioBox text={card.scenario} textEn={card.scenario_en} /> : null}
            <View style={styles.questionBlock}>
              <Text style={[styles.q, { color: colors.ink }]}>{card.q}</Text>
              {compactText(card.q_en) ? (
                <Text style={[styles.qEn, { color: colors.muted }]}>{compactText(card.q_en)}</Text>
              ) : null}
            </View>

            {isChoice && eph.shuffledOptions ? (
              <>
                <OptionList
                  options={eph.shuffledOptions.items}
                  optionSubtexts={optionSubtexts}
                  correctDisplay={correctDisplay}
                  selected={eph.multiSel}
                  revealed={eph.phase === 'revealed'}
                  picked={eph.pickedDisplay}
                  monospace={card.format === 'code'}
                  optionDiagrams={optionDiagrams}
                  onPress={pickChoice}
                />
                {eph.phase === 'question' ? (
                  <View style={styles.btnRow}>
                    {card.format === 'multi' ? <ActButton label="检查" onPress={checkMulti} /> : null}
                    <GhostButton label="🤔 不确定，看答案" onPress={idk} />
                  </View>
                ) : null}
              </>
            ) : null}

            {card.format === 'cloze' && card.text ? (
              <>
                <ClozeView text={card.text} textEn={card.text_en} revealed={eph.phase === 'revealed'} />
                {eph.phase === 'question' ? (
                  <View style={styles.btnRow}>
                    <ActButton label="🤔 不确定 / 显示答案" onPress={revealCloze} />
                  </View>
                ) : null}
              </>
            ) : null}

            {card.format === 'chain' && eph.shuffledSteps && card.answerOrder ? (
              <>
                <ChainView
                  steps={eph.shuffledSteps.items}
                  toOriginal={eph.shuffledSteps.toOriginal}
                  pickedOriginal={eph.chainPicked}
                  revealed={eph.phase === 'revealed'}
                  answerOrder={card.answerOrder}
                  wasCorrect={eph.wasCorrect}
                  onPick={pickStep}
                  onReset={resetChain}
                />
                {eph.phase === 'question' ? (
                  <View style={styles.btnRow}>
                    <GhostButton label="🤔 不确定，看正确顺序" onPress={idk} />
                  </View>
                ) : null}
              </>
            ) : null}

            {eph.phase === 'revealed' && !sideReveal ? (
              <View onLayout={(e) => (revealY.current = e.nativeEvent.layout.y)}>
                <RevealBlock
                  card={card}
                  verdict={eph.verdict}
                  flags={eph.flags}
                  term={eph.term}
                  note={eph.note}
                  optionDetails={optionDetails}
                  onToggleFlag={toggleFlag}
                  onTerm={(v) => setEph((e) => ({ ...e, term: v }))}
                  onNote={(v) => setEph((e) => ({ ...e, note: v }))}
                  onGrade={grade}
                />
              </View>
            ) : null}
          </View>

          {sideReveal ? (
            <View
              onLayout={(e) => (revealY.current = e.nativeEvent.layout.y)}
              style={[
                styles.sidePanel,
                {
                  width: sidePanelWidth,
                  maxHeight: sidePanelMaxHeight,
                  backgroundColor: colors.card,
                  borderColor: colors.line,
                },
              ]}
            >
              <ScrollView
                nestedScrollEnabled
                style={styles.sidePanelScroll}
                contentContainerStyle={styles.sidePanelContent}
              >
                <RevealBlock
                  panel
                  card={card}
                  verdict={eph.verdict}
                  flags={eph.flags}
                  term={eph.term}
                  note={eph.note}
                  optionDetails={optionDetails}
                  onToggleFlag={toggleFlag}
                  onTerm={(v) => setEph((e) => ({ ...e, term: v }))}
                  onNote={(v) => setEph((e) => ({ ...e, note: v }))}
                  onGrade={grade}
                />
              </ScrollView>
            </View>
          ) : null}
        </View>
        <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: 18 }}>
          忘了 / 模糊 / 记得 → FSRS 排期
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scrollBody: { paddingHorizontal: 16, paddingBottom: 48 },
  scrollBodyWide: { width: '100%', maxWidth: 1180, alignSelf: 'center' },
  studyGrid: { gap: 16 },
  studyGridWide: { flexDirection: 'row', alignItems: 'flex-start' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 10,
  },
  card: { borderWidth: 1, borderRadius: 16, padding: 20 },
  questionPane: { flex: 1, minWidth: 0 },
  sidePanel: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  sidePanelScroll: { flexGrow: 0 },
  sidePanelContent: { padding: 20, paddingBottom: 24 },
  questionBlock: { marginBottom: 14 },
  q: { fontSize: 17, fontWeight: '600', lineHeight: 25 },
  qEn: { fontSize: 13, lineHeight: 19, marginTop: 5 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
});
