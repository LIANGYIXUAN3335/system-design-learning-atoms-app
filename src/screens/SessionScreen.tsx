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

function clipText(text: string | undefined, max = 96): string {
  const compact = compactText(text);
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1).trim()}…`;
}

function asSentence(text: string): string {
  const compact = compactText(text);
  if (!compact) return '';
  return /[。.!?！？]$/.test(compact) ? compact : `${compact}。`;
}

function correctOptionSummary(card: Card): string {
  if (!card.options || !card.answer?.length) return '正确答案';
  return card.answer
    .map((index) => card.options?.[index])
    .filter(Boolean)
    .map((option) => `「${option}」`)
    .join('、');
}

interface InferredOptionFrame {
  meaning: string;
  impact: string;
}

function hasAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function inferOptionFrame(option: string): InferredOptionFrame | null {
  const lower = option.toLowerCase();

  if (hasAny(lower, ['太慢', '过慢', '性能', 'latency', 'slow'])) {
    return {
      meaning: `「${option}」是在把问题归因到组件或链路性能：它假设瓶颈来自某个东西本身不够快。`,
      impact: '选择它会把排查带向容量、延迟或性能调优，而不是先看架构职责是否放在了正确时刻。',
    };
  }
  if (hasAny(lower, ['索引', 'index'])) {
    return {
      meaning: `「${option}」是在把问题归因到索引或查询路径：它假设数据访问方式没有设计好。`,
      impact: '选择它会让你优先优化查询路径、二级索引或访问模式，而不是先改变系统的整体数据流。',
    };
  }
  if (hasAny(lower, ['网络', '带宽', 'network', 'bandwidth'])) {
    return {
      meaning: `「${option}」是在把问题归因到网络传输：它关注带宽、跨地域距离或链路延迟。`,
      impact: '选择它会让方案先去压缩传输、就近部署或扩容网络，而不是先处理业务计算/存储模型。',
    };
  }
  if (hasAny(lower, ['预计算', 'fan-out', '读取', '读时', '写入', '写时', '计算', 'read', 'write'])) {
    return {
      meaning: `「${option}」是在讨论工作发生的时机：到底把计算放在写入侧、读取侧，还是提前预计算。`,
      impact: '选择它会把设计重心放到读写路径的职责分配上，也就是谁提前做工作、谁保持低延迟。',
    };
  }
  if (hasAny(lower, ['cdn', '边缘'])) {
    return {
      meaning: `「${option}」是边缘分发/边缘缓存方案，核心是把静态内容放到离用户更近的位置。`,
      impact: '选择它会让系统优先解决全球静态内容分发和跨地域延迟，而不是应用服务器内部的数据共享。',
    };
  }
  if (hasAny(lower, ['redis', 'memcached', '缓存', 'cache'])) {
    return {
      meaning: `「${option}」是缓存层方向，用更快的存储保存热点数据，减少主数据库读取压力。`,
      impact: '选择它会把方案带向命中率、TTL、淘汰策略和缓存一致性这些问题。',
    };
  }
  if (hasAny(lower, ['浏览器', 'client', '客户端'])) {
    return {
      meaning: `「${option}」是客户端侧能力，依赖用户设备或浏览器保存/复用数据。`,
      impact: '选择它会把优化放到单个用户设备上，通常不能解决多台服务端共享状态的问题。',
    };
  }
  if (hasAny(lower, ['进程内', 'in-process', '本地缓存'])) {
    return {
      meaning: `「${option}」是单机本地优化，把数据放在某个服务进程自己的内存里。`,
      impact: '选择它会获得很低延迟，但也会引入多实例不共享、重启丢失和一致性更弱的问题。',
    };
  }
  if (hasAny(lower, ['kafka', 'queue', '队列', 'pub/sub', 'sqs', 'stream'])) {
    return {
      meaning: `「${option}」是异步队列或事件流方向，用缓冲和消费者解耦生产者与处理逻辑。`,
      impact: '选择它会把系统变成异步处理模型，适合削峰和解耦，但会引入延迟、重试和幂等问题。',
    };
  }
  if (hasAny(lower, ['postgres', 'mysql', 'sql', '关系型', 'relational'])) {
    return {
      meaning: `「${option}」是关系型数据库方向，强调事务、约束、查询能力和清晰的数据模型。`,
      impact: '选择它会优先保证一致性和查询表达力，但横向写扩展通常要额外设计。',
    };
  }
  if (hasAny(lower, ['cassandra', 'dynamodb', 'nosql'])) {
    return {
      meaning: `「${option}」是分布式 NoSQL 存储方向，通常用分区和副本换取更强的水平扩展能力。`,
      impact: '选择它会把方案带向访问模式建模、分区键选择、最终一致性和热点分散。',
    };
  }
  if (hasAny(lower, ['shard', '分片', 'partition'])) {
    return {
      meaning: `「${option}」是水平拆分数据的方向，把数据按某个键分散到多个分区或节点。`,
      impact: '选择它会优先解决容量和吞吐扩展，但也会带来热点、跨分片查询和再均衡成本。',
    };
  }
  if (hasAny(lower, ['replica', '复制', 'leader', 'follower', 'quorum'])) {
    return {
      meaning: `「${option}」是复制与一致性方向，关注副本如何同步、读写走哪里、需要多少确认。`,
      impact: '选择它会把方案带向可用性、一致性、故障切换和读扩展之间的取舍。',
    };
  }
  if (hasAny(lower, ['websocket', 'sse', 'polling', 'http', 'grpc', 'tcp', 'udp', 'webrtc'])) {
    return {
      meaning: `「${option}」是通信协议或连接模式方向，决定客户端和服务端怎样交换数据。`,
      impact: '选择它会优先影响实时性、连接成本、双向通信能力、可靠性和基础设施复杂度。',
    };
  }
  if (hasAny(lower, ['consistency', '一致性'])) {
    return {
      meaning: `「${option}」是在强调一致性：用户或节点是否能马上看到同一份最新数据。`,
      impact: '选择它会让系统优先避免旧读和冲突，但通常会牺牲部分可用性或延迟。',
    };
  }
  if (hasAny(lower, ['availability', '可用性'])) {
    return {
      meaning: `「${option}」是在强调可用性：请求尽量得到响应，即使结果可能不是最新。`,
      impact: '选择它会让系统优先保持服务可响应，但需要接受更弱一致性或后续修正。',
    };
  }
  if (hasAny(lower, ['acid', '事务', 'transaction'])) {
    return {
      meaning: `「${option}」是事务/不变量方向，关注一组操作是否原子、隔离并保持约束。`,
      impact: '选择它会把设计重点放到正确性边界和并发控制上，通常不是所有分布式取舍的第一层答案。',
    };
  }
  if (hasAny(lower, ['内存', 'memory', 'cpu', '磁盘', 'disk', 'ssd'])) {
    return {
      meaning: `「${option}」是在比较硬件和存储介质延迟：内存、CPU、磁盘距离不同，访问成本不同。`,
      impact: '选择它会让解释落在物理延迟和存储层级上，而不是软件接口或语法开销。',
    };
  }

  return null;
}

function inferOptionFrameEn(option: string): InferredOptionFrame | null {
  const lower = option.toLowerCase();

  if (hasAny(lower, ['太慢', '过慢', '性能', 'latency', 'slow'])) {
    return {
      meaning: `The option "${option}" frames the problem as a component or link performance bottleneck.`,
      impact: 'Choosing it pushes the design toward capacity, latency, or performance tuning before checking whether work is assigned to the right part of the architecture.',
    };
  }
  if (hasAny(lower, ['索引', 'index'])) {
    return {
      meaning: `The option "${option}" frames the problem as an indexing or query-access-path issue.`,
      impact: 'Choosing it pushes the solution toward query/index optimization before changing the overall data flow.',
    };
  }
  if (hasAny(lower, ['网络', '带宽', 'network', 'bandwidth'])) {
    return {
      meaning: `The option "${option}" frames the problem as a network-transfer issue.`,
      impact: 'Choosing it pushes the solution toward bandwidth, placement, or transport optimization before addressing the business computation or storage model.',
    };
  }
  if (hasAny(lower, ['预计算', 'fan-out', '读取', '读时', '写入', '写时', '计算', 'read', 'write'])) {
    return {
      meaning: `The option "${option}" is about when the work happens: read time, write time, or ahead-of-time precomputation.`,
      impact: 'Choosing it puts the design focus on read/write path responsibility and who must do work before the user waits.',
    };
  }
  if (hasAny(lower, ['cdn', '边缘'])) {
    return {
      meaning: `The option "${option}" is an edge distribution or edge caching layer.`,
      impact: 'Choosing it targets global static content delivery and cross-region latency more than server-side shared application state.',
    };
  }
  if (hasAny(lower, ['redis', 'memcached', '缓存', 'cache'])) {
    return {
      meaning: `The option "${option}" is a caching-layer direction for hot data and database read relief.`,
      impact: 'Choosing it brings in hit rate, TTL, eviction, and cache consistency trade-offs.',
    };
  }
  if (hasAny(lower, ['kafka', 'queue', '队列', 'pub/sub', 'sqs', 'stream'])) {
    return {
      meaning: `The option "${option}" is an async queue or event-stream direction.`,
      impact: 'Choosing it changes the system into an asynchronous processing model with retries, latency, and idempotency concerns.',
    };
  }
  if (hasAny(lower, ['postgres', 'mysql', 'sql', '关系型', 'relational'])) {
    return {
      meaning: `The option "${option}" is a relational-database direction.`,
      impact: 'Choosing it emphasizes transactions, constraints, and query power, with extra work for horizontal write scaling.',
    };
  }
  if (hasAny(lower, ['cassandra', 'dynamodb', 'nosql'])) {
    return {
      meaning: `The option "${option}" is a distributed NoSQL storage direction.`,
      impact: 'Choosing it pushes the design toward access-pattern modeling, partition-key choice, eventual consistency, and hot-key avoidance.',
    };
  }
  if (hasAny(lower, ['websocket', 'sse', 'polling', 'http', 'grpc', 'tcp', 'udp', 'webrtc'])) {
    return {
      meaning: `The option "${option}" is a protocol or connection-pattern choice.`,
      impact: 'Choosing it mainly affects real-time behavior, connection cost, bidirectionality, reliability, and infrastructure complexity.',
    };
  }

  return null;
}

function optionIdentityFromLegacy(explanation: string): string {
  const cleaned = compactText(explanation).replace(/^正确[，。:：\s]*/, '');
  const firstClause = cleaned.split(/[。；;]/)[0]?.trim() ?? '';
  if (firstClause.length < 6 || firstClause.length > 72) return '';
  if (!/(是|指|描述|代表|用于|适合|对应|关系)/.test(firstClause)) return '';
  return asSentence(`已有解释把它定位为：${firstClause}`);
}

// Fallback policy (rubric 1.3-F1): empty beats filler. When there's no
// explicit note, no usable legacy text, and no keyword-inferred frame, we show
// NOTHING for that slot — the old catch-all template sentences ("……是这道题里
// 的概念判断，代表一种可以拿来比较的判断路径") carried zero information and
// re-read `why` up to 4×, which is exactly the bloat being removed.
function optionMeaning(card: Card, originalIndex: number, option: string): string {
  const explicit = compactText(card.optionMeanings?.[originalIndex]);
  if (explicit) return explicit;

  const legacyIdentity = optionIdentityFromLegacy(card.optionExplanations?.[originalIndex] ?? '');
  if (legacyIdentity) return legacyIdentity;

  return inferOptionFrame(option)?.meaning ?? '';
}

function optionScenarioImpact(card: Card, originalIndex: number): string {
  const explicit = compactText(card.optionScenarioImpacts?.[originalIndex]);
  if (explicit) return explicit;

  return inferOptionFrame(card.options?.[originalIndex] ?? '')?.impact ?? '';
}

function optionDirectness(card: Card, originalIndex: number, isCorrect: boolean): string {
  const explicit = compactText(card.optionDirectness?.[originalIndex]);
  if (explicit) return explicit;

  const legacy = compactText(card.optionExplanations?.[originalIndex]);
  if (legacy) return asSentence(legacy);

  // Correct option: one pointer back to the deciding constraint. Wrong
  // options get no auto-generated comparison — `why` (shown once above) and
  // `whenOtherWins` (own amber box) already carry it; repeating them per
  // option was the main source of the re-reading bloat.
  if (isCorrect) {
    const why = compactText(card.why);
    return why ? `它最直接命中题目的关键约束：${clipText(why, 90)}` : '';
  }
  return '';
}

// One flowing English sentence-run per option — no "Meaning:/Scenario:/Fit:"
// labels; the zh paragraph above it already carries the structure.
function optionExplanationEn(card: Card, originalIndex: number, option: string, isCorrect: boolean): string {
  const inferred = inferOptionFrameEn(option);
  const meaning = compactText(card.optionMeanings_en?.[originalIndex]) || inferred?.meaning || '';
  const scenario = compactText(card.optionScenarioImpacts_en?.[originalIndex]) || inferred?.impact || '';
  const directness =
    compactText(card.optionDirectness_en?.[originalIndex]) ||
    compactText(card.optionExplanations_en?.[originalIndex]) ||
    (compactText(card.why_en) && isCorrect
      ? `This is the most direct answer because ${compactText(card.why_en)}`
      : '');

  return [meaning, scenario, directness].filter(Boolean).join(' ');
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
    meaning: optionMeaning(card, originalIndex, text),
    scenarioImpact: optionScenarioImpact(card, originalIndex),
    directness: optionDirectness(card, originalIndex, isCorrect),
    explanationEn: optionExplanationEn(card, originalIndex, text, isCorrect),
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
            {card.scenario ? <ScenarioBox text={card.scenario} /> : null}
            <Text style={[styles.q, { color: colors.ink }]}>{card.q}</Text>

            {isChoice && eph.shuffledOptions ? (
              <>
                <OptionList
                  options={eph.shuffledOptions.items}
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
                <ClozeView text={card.text} revealed={eph.phase === 'revealed'} />
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
  q: { fontSize: 17, fontWeight: '600', marginBottom: 14, lineHeight: 25 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
});
