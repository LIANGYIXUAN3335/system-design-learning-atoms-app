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
import { chainCorrect, choiceCorrect, minIntervalDays, toFeedbackGrade, toFsrsRating } from '../logic/grading';
import { dueAdditions, removeCurrentQueueCard, type SrsEntry } from '../logic/queue';
import { shuffleWithMap, type Shuffled } from '../logic/shuffle';
import { applyReview, emptyCard } from '../logic/srs';
import { becameRemembered, fastAnswerNote, nextWinLevel, readingTimerMs, type TypicalTimes } from '../logic/gameFeel';
import { feelSmallWin } from '../feel';
import { logReview, saveFeedback, saveSrs, type Db } from '../db/database';
import { syncNow } from '../sync';
import { useTheme } from '../theme';
import type { Card, FeedbackRow, FlagKey, SelfGrade } from '../types';
import { ChainView } from '../components/ChainView';
import { ClozeView } from '../components/ClozeView';
import { ProduceView } from '../components/ProduceView';
import { OptionList } from '../components/OptionList';
import { RevealBlock, type Verdict } from '../components/RevealBlock';
import type { AnswerOptionDetail } from '../components/AnswerDetailPad';
import { ActButton, GhostButton, ProgressBar, ScenarioBox, TagRow } from '../components/ui';
import { PlusOne, SoftTimerRing, useWinPulse, WinFlash } from '../components/GameFeel';

const OPTION_LABELS = 'ABCDEFGH';

export interface SessionStore {
  srs: Map<string, SrsEntry>;
  fb: Map<string, FeedbackRow>;
}

export interface SessionStats {
  answered: number;
  /** 答对：客观答对，或填空题自评「记得」（填空没有客观对错） */
  correct: number;
  /** A3「这组 y 张从忘记变成记住了」——判定见 logic/gameFeel.ts becameRemembered() */
  learned: number;
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
  /** produce：翻面后打了勾的验收项下标（只在这一屏，不落库） */
  checked: Set<number>;
  wasCorrect: boolean | null;
  usedIdk: boolean;
  /** A1：出题 → 作答（翻面）的毫秒数；还没作答时为 null */
  answerMs: number | null;
  flags: FlagKey[];
  term: string;
  note: string;
  /** 真正发出去的那句（persistFeedback 用它，不用草稿） */
  noteSent: string;
  fbSubmitted: boolean;
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
  /** Cards already graded today; excluded from same-day requeue sweeps. */
  reviewedToday?: Set<string>;
  /** M3 §3.2: deadline-scaled minimum interval for a correct-but-fuzzy card */
  correctFuzzyFloor: number;
  /** A1 软计时的基准：读题阶段按每个卡型历史中位数的三倍走。 */
  typicalTimes: TypicalTimes;
  /** A2 音效开关（设置页「音效」） */
  soundEnabled: boolean;
  onAddSupplement: (source: Card, title: string, explanation: string) => Promise<'cloud' | 'local'>;
  onDeleteCard: (cardId: string) => Promise<void>;
  onExit: () => void;
  onDone: (stats: SessionStats) => void;
}

/** 读题阶段的秒表：每秒 +1，翻面就停。只在 UI 上走，不进任何记录。 */
function useReadingSeconds(startTs: number, running: boolean): number {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    setSec(Math.max(0, Math.floor((Date.now() - startTs) / 1000)));
    if (!running) return;
    const id = setInterval(() => setSec(Math.max(0, Math.floor((Date.now() - startTs) / 1000))), 1000);
    return () => clearInterval(id);
  }, [startTs, running]);
  return sec;
}

export function SessionScreen({
  db,
  cards,
  store,
  initialQueue,
  requeueScope,
  reviewedToday,
  correctFuzzyFloor,
  typicalTimes,
  soundEnabled,
  onAddSupplement,
  onDeleteCard,
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
  const statsRef = useRef<SessionStats>({ answered: 0, correct: 0, learned: 0 });
  /** 组内连续答对的「叮」级数（0 = 刚归零） */
  const winLevelRef = useRef(0);
  const winPulse = useWinPulse();
  const reviewedTodayRef = useRef<Set<string>>(new Set(reviewedToday ?? []));
  const deleteInFlightRef = useRef(false);
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
      checked: new Set(),
      wasCorrect: null,
      usedIdk: false,
      answerMs: null,
      flags: prevFb ? [...prevFb.flags] : [],
      term: prevFb?.term ?? '',
      note: prevFb?.note ?? '',
      noteSent: prevFb?.note ?? '',
      fbSubmitted: false,
      startTs: Date.now(),
    };
  };

  const [eph, setEph] = useState<Ephemeral>(() => initEphemeral(cardsById.get(initialQueue[0])));
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingCard, setDeletingCard] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Defensive: end the session if the queue references a card no longer in the deck.
  useEffect(() => {
    if (!card) onDone(statsRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card]);
  if (!card) return null;

  const persistFeedback = (patch: Partial<FeedbackRow>): Promise<void> => {
    const row: FeedbackRow = {
      cardId: card.id,
      grade: store.fb.get(card.id)?.grade ?? null,
      flags: eph.flags,
      term: eph.term,
      note: eph.noteSent,
      updatedAt: new Date().toISOString(),
      ...patch,
    };
    store.fb.set(card.id, row);
    return saveFeedback(db, row).catch((e) => console.warn('saveFeedback failed', e));
  };

  const scrollToReveal = () => {
    setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, revealY.current - 60), animated: true }), 80);
  };

  /** A2 小档：只在「做成了」时调用。答错 / 不会 / 看答案永远不走这里（§2 硬规矩）。 */
  const celebrateWin = () => {
    winPulse.fire();
    // 「叮」按组内连续答对升级：1→5 级封顶；答错 / 模糊 / 看答案在下面归 0
    winLevelRef.current = nextWinLevel(winLevelRef.current, true);
    feelSmallWin(soundEnabled, winLevelRef.current);
  };

  const reveal = (verdict: Verdict, wasCorrect: boolean | null, usedIdk: boolean, pickedDisplay?: Set<number>) => {
    const answerMs = Date.now() - eph.startTs;
    if (verdict !== 'correct') winLevelRef.current = nextWinLevel(winLevelRef.current, false);
    setEph((e) => ({
      ...e,
      phase: 'revealed',
      verdict,
      wasCorrect,
      usedIdk,
      answerMs,
      pickedDisplay: pickedDisplay ?? e.pickedDisplay,
    }));
    if (verdict === 'correct') celebrateWin();
    scrollToReveal();
  };

  /** ✏️ 改这张卡 → 发给 Claude 改：存本机，再立刻上云（上云失败也不丢，下次同步带走）。 */
  const submitFeedback = async (): Promise<'cloud' | 'local'> => {
    const note = eph.note.trim();
    setEph((e) => ({ ...e, noteSent: note, fbSubmitted: true }));
    await persistFeedback({ note, flags: eph.flags, term: eph.term });
    try {
      const snap = await syncNow(db);
      return snap ? 'cloud' : 'local';
    } catch {
      return 'local';
    }
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

  /** produce：她写好了 → 翻面看参考答案 + 清单；没有客观对错，成绩走下面的自评（和填空一样）。 */
  const revealProduce = () => {
    if (eph.phase !== 'question') return;
    reveal('produced', null, false);
  };

  const toggleChecked = (i: number) => {
    setEph((e) => {
      const checked = new Set(e.checked);
      if (checked.has(i)) checked.delete(i);
      else checked.add(i);
      return { ...e, checked };
    });
  };

  /** 读题环到点只翻答案，不写入评分；用户仍需自己选忘了/模糊/记得。 */
  // ---- grading ---------------------------------------------------------

  const grade = (g: SelfGrade) => {
    const now = new Date();
    const rating = toFsrsRating(g, eph.wasCorrect, eph.usedIdk);
    // M3 §3.2: correctness-gated floor — a correct-but-shaky card must not return
    // tomorrow. (Phase 2 will pass a deadline-scaled floor derived from the plan.)
    const floorDays = minIntervalDays(g, eph.wasCorrect, eph.usedIdk, correctFuzzyFloor);
    const existing = store.srs.get(card.id);
    const prev = existing?.fsrs ?? emptyCard(now);
    const entry: SrsEntry = {
      fsrs: applyReview(prev, now, rating, floorDays),
      firstSeen: existing?.firstSeen ?? localDateStr(now),
    };
    const learnedNow = becameRemembered(prev.state, entry.fsrs.state, rating);
    store.srs.set(card.id, entry);
    const srsWrite = saveSrs(db, card.id, entry).catch((e) => console.warn('saveSrs failed', e));
    const reviewWrite = logReview(db, {
      cardId: card.id,
      ts: now,
      day: localDateStr(now),
      rating,
      wasCorrect: eph.wasCorrect,
      usedIdk: eph.usedIdk,
      elapsedMs: Date.now() - eph.startTs,
    }).catch((e) => console.warn('logReview failed', e));
    const feedbackWrite = persistFeedback({ grade: toFeedbackGrade(g) });
    // Keep the interaction instant locally, but upload only after all three
    // SQLite writes have completed so the newest review cannot be missed.
    void Promise.all([srsWrite, reviewWrite, feedbackWrite]).then(() => syncNow(db).catch(() => {}));

    // 填空题没有客观对错，自评「记得」就算答对；它的小档庆祝也放在这里（选择 / 排序题在翻面时已经庆祝过）。
    const clozeGot = eph.wasCorrect === null && !eph.usedIdk && g === 'got';
    if (clozeGot) celebrateWin();
    if (g !== 'got') winLevelRef.current = nextWinLevel(winLevelRef.current, false);
    statsRef.current = {
      answered: statsRef.current.answered + 1,
      correct: statsRef.current.correct + (eph.wasCorrect === true || clozeGot ? 1 : 0),
      learned: statsRef.current.learned + (learnedNow ? 1 : 0),
    };
    reviewedTodayRef.current.add(card.id);

    // Requeue sweep: cards that became due (the just-lapsed card, learning
    // steps maturing) go to the END of the queue — bounded to sweepScope so a
    // mode-filtered session never pulls in cards the user excluded.
    const unavailableToday = new Set([...queue, ...reviewedTodayRef.current]);
    const additions = dueAdditions(store.srs, sweepScope, unavailableToday, new Date());
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

  /**
   * Curation is intentionally separate from grading: delete locally first so
   * the active queue advances immediately, while App uploads the change in the
   * background. This never increments answer/review stats.
   */
  const removeCurrentCard = async () => {
    if (deleteInFlightRef.current) return;
    deleteInFlightRef.current = true;
    setDeletingCard(true);
    setDeleteError(null);

    try {
      await onDeleteCard(card.id);
      const next = removeCurrentQueueCard(queue, pos);
      if (next.nextIndex === null) {
        onDone(statsRef.current);
        return;
      }

      setQueue(next.queue);
      setPos(next.nextIndex);
      setEph(initEphemeral(cardsById.get(next.queue[next.nextIndex])));
      setDeleteConfirmOpen(false);
      setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: false }), 30);
    } catch {
      setDeleteError('这张卡没有移除成功，请再试一次。');
    } finally {
      deleteInFlightRef.current = false;
      setDeletingCard(false);
    }
  };

  // ---- render ----------------------------------------------------------

  // one flag handler + one props object, shared by the inline and side-panel
  // reveal renders so the persistence wiring can't drift between layouts
  const toggleFlag = (f: FlagKey) => {
    const flags = eph.flags.includes(f) ? eph.flags.filter((x) => x !== f) : [...eph.flags, f];
    persistFeedback({ flags });
    setEph((e) => ({ ...e, flags }));
  };

  const total = queue.length;
  const currentIndex = Math.min(pos + 1, Math.max(1, total));
  const remaining = total - pos;
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
  const typicalMs = typicalTimes[card.atomType]?.ms ?? 15_000;
  const timerMs = readingTimerMs(card.format);
  // 读题秒数：先倒数到 0，再「+N 秒」正计时继续走；颜色不变、不弹窗、不替她翻面。
  const readingSec = useReadingSeconds(eph.startTs, eph.phase === 'question');
  const remainingSec = Math.round(timerMs / 1000) - readingSec;
  const timerLabel = remainingSec >= 0 ? `${remainingSec} 秒` : `+${-remainingSec} 秒`;
  // A1：答对才看快慢，而且只报「快」——慢了什么都不说（§7 A3 精神）
  const speedNote = eph.verdict === 'correct' ? fastAnswerNote(eph.answerMs, typicalMs) : null;
  const sidePanelWidth = Math.min(460, Math.max(360, width * 0.36));
  const sidePanelMaxHeight = Math.max(430, height - 136);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Pressable
          onPress={onExit}
          hitSlop={10}
          style={({ pressed }) => [
            styles.homeBtn,
            { borderColor: pressed ? colors.accent : colors.line },
          ]}
        >
          <Text style={{ color: colors.ink, fontSize: 14, fontWeight: '600' }}>主页</Text>
        </Pressable>
        <View style={styles.headerRight}>
          {eph.phase === 'question' ? (
            <View
              accessibilityLabel={`读题计时，${Math.ceil(timerMs / 1000)} 秒；走完继续正计时，不翻面不计错`}
              style={[styles.timerDock, { borderColor: colors.line, backgroundColor: colors.card }]}
            >
              <SoftTimerRing key={`${pos}-${card.id}`} durationMs={timerMs} />
              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] }}>
                {timerLabel}
              </Text>
            </View>
          ) : null}
          <View style={styles.progressLabel}>
            <Text style={{ color: colors.ink, fontSize: 14, fontWeight: '600' }}>
              第 {currentIndex} / {total} 张
            </Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>
              已答 {answered} · 剩余 {remaining}
            </Text>
          </View>
        </View>
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
            <WinFlash pulse={winPulse.value} />
            <View style={styles.tagRowWrap}>
              <TagRow card={card} />
            </View>
            {eph.phase === 'question' ? (
              <View style={[styles.curationRow, { borderColor: colors.line, backgroundColor: colors.bg }]}>
                {deleteConfirmOpen ? (
                  <>
                    <Text style={[styles.curationPrompt, { color: colors.ink }]}>从我的题库移除这张卡？</Text>
                    <View style={styles.curationActions}>
                      <Pressable
                        onPress={removeCurrentCard}
                        disabled={deletingCard}
                        style={[styles.removeButton, { backgroundColor: deletingCard ? colors.line : colors.bad }]}
                      >
                        <Text style={{ color: deletingCard ? colors.muted : '#fff', fontSize: 13, fontWeight: '700' }}>
                          {deletingCard ? '移除中…' : '确认移除'}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          if (deletingCard) return;
                          setDeleteConfirmOpen(false);
                          setDeleteError(null);
                        }}
                        disabled={deletingCard}
                        hitSlop={8}
                      >
                        <Text style={{ color: colors.muted, fontSize: 13 }}>取消</Text>
                      </Pressable>
                    </View>
                  </>
                ) : (
                  <Pressable
                    onPress={() => {
                      setDeleteConfirmOpen(true);
                      setDeleteError(null);
                    }}
                    hitSlop={8}
                    accessibilityLabel="从个人题库移除这张卡"
                  >
                    <Text style={{ color: colors.bad, fontSize: 13, fontWeight: '700' }}>删除这张卡</Text>
                  </Pressable>
                )}
                {deleteError ? <Text style={{ color: colors.bad, fontSize: 13, marginTop: 7 }}>{deleteError}</Text> : null}
              </View>
            ) : null}
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

            {card.format === 'produce' && card.checklist ? (
              <ProduceView
                checklist={card.checklist}
                checklistEn={card.checklist_en}
                checked={eph.checked}
                revealed={eph.phase === 'revealed'}
                clarificationReview={card.clarificationReview}
                cardId={card.id}
                onReveal={revealProduce}
                onToggle={toggleChecked}
              />
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
                  speedNote={speedNote}
                  onToggleFlag={toggleFlag}
                  onTerm={(v) => setEph((e) => ({ ...e, term: v }))}
                  onNote={(v) => setEph((e) => ({ ...e, note: v }))}
                  feedbackSubmitted={eph.fbSubmitted}
                  onSubmitFeedback={submitFeedback}
                  onAddSupplement={(title, explanation) => onAddSupplement(card, title, explanation)}
                  onDeleteCard={removeCurrentCard}
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
                  speedNote={speedNote}
                  onToggleFlag={toggleFlag}
                  onTerm={(v) => setEph((e) => ({ ...e, term: v }))}
                  onNote={(v) => setEph((e) => ({ ...e, note: v }))}
                  feedbackSubmitted={eph.fbSubmitted}
                  onSubmitFeedback={submitFeedback}
                  onAddSupplement={(title, explanation) => onAddSupplement(card, title, explanation)}
                  onDeleteCard={removeCurrentCard}
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
      <PlusOne pulse={winPulse.value} />
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
  homeBtn: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 58,
    alignItems: 'center',
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progressLabel: { alignItems: 'flex-end', gap: 2 },
  timerDock: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 5 },
  card: { borderWidth: 1, borderRadius: 16, padding: 20 },
  tagRowWrap: {},
  curationRow: { alignSelf: 'flex-start', marginTop: 12, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  curationPrompt: { fontSize: 13, fontWeight: '700' },
  curationActions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  removeButton: { borderRadius: 8, paddingHorizontal: 11, paddingVertical: 8 },
  questionPane: { flex: 1, minWidth: 0 },
  sidePanel: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  sidePanelScroll: { flexGrow: 0 },
  sidePanelContent: { padding: 20, paddingBottom: 24 },
  questionBlock: { marginBottom: 14 },
  q: { fontSize: 17, fontWeight: '600', lineHeight: 25 },
  qEn: { fontSize: 13, lineHeight: 19, marginTop: 5 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
});
