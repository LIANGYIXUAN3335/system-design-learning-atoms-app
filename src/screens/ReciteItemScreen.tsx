import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useTheme, type Palette } from '../theme';
import { ProgressBar } from '../components/ui';
import { AudioTrack, type AudioTrackHandle } from '../components/AudioTrack';
import {
  dialogUrl,
  getItem,
  mark as markItem,
  origUrl,
  reciteConfigured,
  rescore,
  takeUrl,
  uploadTake,
} from '../recite/api';
import {
  dots,
  fmtClock,
  PRACTICE_STEPS,
  practiceAt,
  segmentSecLabel,
  hasScriptVersions,
  resolveVersion,
  splitCanon,
  versionOptions,
} from '../recite/library';
import { threadById, threadSiblings, type ResolvedSegment, type ResolvedThread } from '../recite/threads';
import { libraryCache, markOverviewStale } from '../recite/libraryCache';
import { flushPracticeQueue, hasQueuedPractice, peekQueuedPractice, sendPracticeMark } from '../recite/practice';
import { scriptVersionPref, setScriptVersionPref } from '../recite/prefs';
import { useRecorder } from '../recite/useRecorder';
import type {
  ActiveVariant,
  PracticeStep,
  ReciteItem,
  ReciteItemStatus,
  ReciteMode,
  ReciteScoreResult,
  ReciteState,
  ReciteTakeSummary,
  ScriptVersion,
} from '../recite/types';

/**
 * 念稿练习页 —— jobscan templates/recite_item.html + static/recite.js 的 RN 版。
 *
 * M4 §0 决定 2：**一屏全开、零闸门**。念稿默认可见（盖稿是开关），原声随时可播，
 * 录完立刻回听 + A/B，AI 评分是一个可选按钮。
 * 8/31 补的那条：追问不许从卡里切走 —— 完整对话面板原样搬（面试官绿底，点句跳播）。
 *
 * 录音一停就上传落盘（不带评分），所以「不点评分」永远不等于「录音丢了」。上传成没成必须
 * 长在录音面板上（✓/✗ + 重试），不能只藏在评分面板的一行小字里 —— 那一行她根本不会去看。
 *
 * 窄屏（手机、半屏笔电）把整个录音区排到题目卡下面、念稿上面：录音键必须一眼看见。
 * 录音期间底部再钉一条 mm:ss + ■停止，好让她一边往下读稿一边随时停。
 *
 * 2026-09-03 起这一页的单位是 **thread**（主问题 + 追问链）。她的原话：一题一张卡，
 * 主问题 → 我的回答（能播）→ 追问 1 → 我的回答 → 追问 2 …「我要听的是他为什么一直追问」。
 * 一次只「练一段」：录音/上传/评分/历次录音永远只属于当前那一段的 item，其余段只读。
 * 单段 thread（现在的绝大多数）走的还是批次 1–4 那套布局，一行没动。
 */

export interface ReciteItemScreenProps {
  items: ReciteItem[];
  threads: ResolvedThread[];
  threadId: string;
  /** 参数是 thread_id —— 上一条/下一条在同场次的 thread 之间走 */
  onOpen: (threadId: string) => void;
  onBack: () => void;
}

/** 两栏门槛。900 会让半屏的 MacBook（~896pt）掉回单栏，所以压到 880。 */
const TWO_COL_MIN_WIDTH = 880;

type UploadState = 'idle' | 'uploading' | 'ok' | 'error';

interface PendingTake {
  body: Blob | string;
  mimeType: string;
  durationSec: number;
  /** 录音开始那一刻冻住的 mode —— 录完再翻盖稿开关，不该改这一遍的判定 */
  mode: ReciteMode;
  /** 同理冻住版本：录完再切长/短版，不该改这一遍念的是哪一版 */
  version: ScriptVersion;
}

function Panel({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.line }]}>
      {children}
    </View>
  );
}

function PanelTitle({ text, right }: { text: string; right?: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.panelHead}>
      <Text style={{ fontSize: 12.5, fontWeight: '600', color: colors.muted, flexShrink: 1 }}>{text}</Text>
      {right ? <View style={{ marginLeft: 'auto' }}>{right}</View> : null}
    </View>
  );
}

function Collapse({
  summary,
  children,
  initialOpen,
}: {
  summary: string;
  children: React.ReactNode;
  initialOpen?: boolean;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(Boolean(initialOpen));
  return (
    <View style={{ marginTop: 9, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 }}>
      <Pressable onPress={() => setOpen((o) => !o)}>
        <Text style={{ fontSize: 13.5, color: colors.accent }}>
          {open ? '▾' : '▸'} {summary}
        </Text>
      </Pressable>
      {open ? <View style={{ marginTop: 6 }}>{children}</View> : null}
    </View>
  );
}

function Btn({
  label,
  onPress,
  disabled,
  tone = 'ghost',
  flex,
  small,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'ghost' | 'primary' | 'record' | 'recording';
  flex?: boolean;
  small?: boolean;
}) {
  const { colors } = useTheme();
  const palette: Record<string, { bg: string; fg: string; border: string }> = {
    ghost: { bg: colors.card, fg: colors.ink, border: colors.line },
    primary: { bg: colors.accent, fg: '#fff', border: colors.accent },
    record: { bg: '#b3261e', fg: '#fff', border: '#b3261e' },
    recording: { bg: '#7f1d18', fg: '#fff', border: '#7f1d18' },
  };
  const p = palette[tone];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        small ? styles.btnSmall : null,
        {
          backgroundColor: p.bg,
          borderColor: p.border,
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
          flex: flex ? 1 : undefined,
        },
      ]}
    >
      <Text style={{ color: p.fg, fontSize: small ? 12.5 : 14 }}>{label}</Text>
    </Pressable>
  );
}

function Small({ children, color }: { children: React.ReactNode; color?: string }) {
  const { colors } = useTheme();
  return <Text style={{ fontSize: 12.5, color: color ?? colors.muted, lineHeight: 19 }}>{children}</Text>;
}

function noteBox(colors: Palette) {
  return {
    backgroundColor: colors.tealBg,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 11,
    marginTop: 9,
  };
}

/** 一句话确认。web 用 window.confirm，原生用 Alert —— 两边都是阻塞式的一问一答。 */
function askConfirm(title: string, message: string, onYes: () => void, yesLabel = '确定'): void {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || window.confirm(`${title}\n\n${message}`)) onYes();
    return;
  }
  Alert.alert(title, message, [
    { text: '取消', style: 'cancel' },
    { text: yesLabel, style: 'destructive', onPress: onYes },
  ]);
}

export function ReciteItemScreen({ items, threads, threadId, onOpen, onBack }: ReciteItemScreenProps) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();

  const thread = useMemo(() => threadById(threads, threadId), [threads, threadId]);
  const mainItem = thread?.main.item ?? null;
  /** 有追问链的 thread 换一套排版：段落纵向铺开，录音面板长在「正在练」的那一段下面 */
  const chainMode = (thread?.segments.length ?? 1) > 1;
  /**
   * 真实面试的题：整页就是当时的原始对话（她 2026-09-03 的要求）。
   * 没有念稿、没有要点、没有就地点评 —— 「念稿这件事是即兴发挥的，不是先写好再念」。
   * playbook / opener 不进这一档，那些稿是先写好再练的，原样保留。
   */
  const dialogMode = thread?.dialogMode ?? false;
  /** 段落纵向铺开的排版（对话流 or 追问链），不再分左右栏 */
  const flowMode = dialogMode || chainMode;
  const twoCol = width >= TWO_COL_MIN_WIDTH && !flowMode;

  const sibs = useMemo(
    () => (thread ? threadSiblings(threads, thread) : []),
    [threads, thread],
  );
  const idx = thread ? sibs.findIndex((t) => t.thread.thread_id === thread.thread.thread_id) : -1;
  const prev = idx > 0 ? sibs[idx - 1] : null;
  const next = idx >= 0 && idx < sibs.length - 1 ? sibs[idx + 1] : null;

  /**
   * 「正在练」的那一段的 item id。录音、上传、评分、历次录音全都只认它 —— 一次只有一段被点亮，
   * 否则她录完根本分不清这一遍算在主问题上还是算在追问 2 上。
   */
  const [armedId, setArmedId] = useState<string>(() => thread?.main.item.id ?? '');
  useEffect(() => {
    setArmedId(thread?.main.item.id ?? '');
  }, [thread]);
  const item = useMemo(
    () => thread?.items.find((i) => i.id === armedId) ?? thread?.main.item ?? null,
    [thread, armedId],
  );

  const [status, setStatus] = useState<ReciteItemStatus | null>(null);
  const [statusPhase, setStatusPhase] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [masked, setMasked] = useState(false);

  // ── 三遍练习法（跟读/闭眼/掐表）──────────────────────────────────────────
  // 初值来自总库 overview 缓存（她的动线永远是库→练，缓存是热的）；点了先本地
  // 乐观置位，再走 practice.ts 的「先进队、随即冲队」通道。
  const [practiceLocal, setPracticeLocal] = useState<
    Record<string, Partial<Record<PracticeStep, string | null>>>
  >({});
  const [practicePending, setPracticePending] = useState(false);
  useEffect(() => {
    // 挂载时：先用队列里还没送达的勾播种本地显示（它们比服务器/库缓存的值新——
    // 不播种的话，断网点的勾这会儿会显示成没勾），再补传；真补上了把库缓存标脏，
    // 否则回库后行标签还是旧读数。
    const pending = peekQueuedPractice();
    if (pending.length) {
      setPracticeLocal((m) => {
        const next = { ...m };
        for (const p of pending) {
          next[p.id] = { ...next[p.id], [p.step]: p.on ? new Date().toISOString() : null };
        }
        return next;
      });
    }
    void flushPracticeQueue().then((sent) => {
      if (sent > 0) markOverviewStale();
      setPracticePending(hasQueuedPractice());
    });
  }, []);
  const practiceVal = useCallback(
    (id: string, step: PracticeStep): string | null => {
      const loc = practiceLocal[id];
      if (loc && step in loc) return loc[step] ?? null;
      const st = libraryCache().overview?.state?.[id] as ReciteState | undefined;
      return practiceAt(st, step);
    },
    [practiceLocal],
  );
  const togglePractice = useCallback(
    (id: string, step: PracticeStep) => {
      const on = practiceVal(id, step) == null;
      setPracticeLocal((m) => ({
        ...m,
        [id]: { ...m[id], [step]: on ? new Date().toISOString() : null },
      }));
      markOverviewStale();
      void sendPracticeMark(id, step, on).then((sent) => setPracticePending(!sent));
    },
    [practiceVal],
  );
  // 稿子版本是跨条目的偏好（她说先把短版练熟），所以初值从 prefs 来，不随换条目重置。
  const [version, setVersion] = useState<ScriptVersion>(scriptVersionPref);
  const [mineUrl, setMineUrl] = useState<string | null>(null);
  const [autoPlayMine, setAutoPlayMine] = useState(false);
  const [takeId, setTakeId] = useState<string | null>(null);
  const [takeMode, setTakeMode] = useState<ReciteMode>('read');
  const [frozenVersion, setFrozenVersion] = useState<ScriptVersion>('base');
  /** 停止请求已发出、结果还没回来 —— 这段时间导航依然要锁住 */
  const [stopping, setStopping] = useState(false);
  const [recNote, setRecNote] = useState('首次点录音会弹麦克风授权，选「允许」。');
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [uploadErr, setUploadErr] = useState('');
  const [uploadNote, setUploadNote] = useState('');
  const [extraRecorded, setExtraRecorded] = useState(0);
  const [whyLine, setWhyLine] = useState('');
  const [scoring, setScoring] = useState(false);
  const [scoreNote, setScoreNote] = useState('');
  const [everScored, setEverScored] = useState(false);
  const [result, setResult] = useState<ReciteScoreResult | null>(null);
  const [cmp, setCmp] = useState<'orig' | 'mine' | null>(null);
  const [localTakes, setLocalTakes] = useState<ReciteTakeSummary[]>([]);
  const [markNote, setMarkNote] = useState('');
  /** 哪一段的原声正在播（一条 thread 共用一个播放器） */
  const [segAudioId, setSegAudioId] = useState<string | null>(null);
  /** 对话流：哪一段的完整对话音频挂在播放器上 */
  const [dlgAudioId, setDlgAudioId] = useState<string | null>(null);
  /** 点某一句要跳到的秒数；seq 每点一次 +1，好让同一秒点第二次也生效 */
  const [seek, setSeek] = useState<{ seq: number; at: number }>({ seq: 0, at: 0 });
  /** 被「单练」拎出来、不再并进上一段的短追问 */
  const [soloIds, setSoloIds] = useState<Set<string>>(new Set());

  const recorder = useRecorder();
  // 换条目时要能停掉上一条的录音，但 recorder 不能进 effect 的依赖（每帧都是新对象）。
  const recorderRef = useRef(recorder);
  recorderRef.current = recorder;
  /** 按下「录音」那一刻的 item.id —— 上传只认这个 id，绝不写到别的条目上 */
  const recordingItemId = useRef<string | null>(null);
  const dialogRef = useRef<AudioTrackHandle>(null);
  const pendingRef = useRef<PendingTake | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const configured = reciteConfigured();

  useEffect(
    () => () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
    },
    [],
  );

  // 换条目 = 整页重来。takeId 若跟着走，评分会评到上一条的录音上。
  useEffect(() => {
    // 保险绳：正常路径下录音时导航是锁死的，真漏过来了就地停掉并丢弃 —— 绝不把上一条的
    // 声音传到新条目名下。onStop 里那道 id 校验是第二道。
    if (recorderRef.current.state === 'recording') {
      void recorderRef.current.stop().catch(() => {});
    }
    recordingItemId.current = null;
    setStopping(false);
    setStatus(null);
    setStatusPhase('loading');
    setStatusNote(null);
    setMasked(false);
    setMineUrl(null);
    setAutoPlayMine(false);
    setTakeId(null);
    setTakeMode('read');
    setFrozenVersion('base');
    setRecNote('首次点录音会弹麦克风授权，选「允许」。');
    setUploadState('idle');
    setUploadErr('');
    setUploadNote('');
    setExtraRecorded(0);
    setWhyLine('');
    setResult(null);
    setEverScored(false);
    setScoreNote('');
    setCmp(null);
    setLocalTakes([]);
    setMarkNote('');
    pendingRef.current = null;
  }, [armedId]);

  useEffect(() => {
    let alive = true;
    if (!configured) {
      setStatusNote('服务不可达：只能看，不能录（没配 EXPO_PUBLIC_ATOM_RECITE_URL 或没有口令）');
      setStatusPhase('failed');
      return;
    }
    if (!armedId) return;
    getItem(armedId)
      .then((s) => {
        if (alive) {
          setStatus(s);
          setStatusPhase('ready');
        }
      })
      .catch((e: unknown) => {
        if (alive) {
          const msg = e instanceof Error ? e.message : String(e);
          setStatusNote(`服务不可达：只能看，不能录 —— ${msg}`);
          setStatusPhase('failed');
        }
      });
    return () => {
      alive = false;
    };
  }, [armedId, configured]);

  /** 盖稿开关此刻代表的 mode（还没开录时的预告） */
  // 对话流里没有稿可盖，这一遍天然是闭卷 —— mode 恒为 recall。
  const liveMode: ReciteMode = dialogMode || masked ? 'recall' : 'read';

  // 选中的版本决定：显示哪份稿、哪份中文对照、目标多少秒、上传 meta 的 version。
  const versions = useMemo(() => (item ? versionOptions(item) : []), [item]);
  const resolved = useMemo(() => (item ? resolveVersion(item, version) : null), [item, version]);
  const versioned = Boolean(item && hasScriptVersions(item));

  const variant: ActiveVariant = status?.variant ?? {
    type: 'original',
    q: item?.question ?? '',
    sec: item?.target_sec ?? 60,
    hint: '',
  };
  const st = status?.state ?? {};
  const nRecorded = (status?.n_recorded ?? st.n_takes ?? 0) + extraRecorded;
  const takeVersion: ScriptVersion = versioned && resolved ? resolved.version : 'base';
  /**
   * 手上有一遍还没了结的 take：正在录、正在停、或者录完了还没评。
   * 这段时间版本开关锁住，目标秒数也认冻住的那版 —— 不然进度条会在她录到一半时跳档。
   */
  const takePending =
    recorder.state === 'recording' || stopping || (Boolean(mineUrl) && !everScored);
  const shownVersionId: ScriptVersion = takePending ? frozenVersion : takeVersion;
  // 有版本就听版本的目标秒数；没有版本才用服务端给的变体秒数。
  const targetSec =
    versioned && item ? resolveVersion(item, shownVersionId).targetSec : variant.sec;
  /** 等授权 / 录音中 / 停止中 —— 这一条被钉住了，哪儿也不能去。
   *  授权也算：那个 await 可能挂很久，中途换条目的话 start() 会在新条目上变成「录音中」。 */
  const busy = recorder.state === 'recording' || stopping || recorder.requesting;

  const doUpload = useCallback(
    async (pending: PendingTake) => {
      if (!item) return;
      pendingRef.current = pending;
      if (!configured) {
        setUploadState('error');
        setUploadErr('没连上服务（没配地址或没有口令）');
        setUploadNote('没连上服务 —— 录音只在这个页面上，别刷新。');
        return;
      }
      setUploadState('uploading');
      setUploadErr('');
      setUploadNote('录音上传中…');
      try {
        const r = await uploadTake(
          item.id,
          pending.body,
          {
            mode: pending.mode,
            variant_type: variant.type,
            variant_sec: variant.sec,
            variant_q: variant.q,
            variant_hint: variant.hint,
            first_exposure: status?.first_exposure ?? false,
            self_est: null,
            duration_sec: Math.round(pending.durationSec),
            version: pending.version,
          },
          pending.mimeType,
        );
        setTakeId(r.take_id);
        setUploadState('ok');
        setUploadNote('录音已存盘。要不要评分随你。');
        setExtraRecorded((n) => n + 1);
        markOverviewStale();
        setLocalTakes((list) => [
          {
            take_id: r.take_id,
            ts: '刚刚',
            total: null,
            verdict: null,
            passed: null,
            audio_url: r.audio_url,
            mode: pending.mode,
            variant_type: variant.type,
            version: pending.version,
          },
          ...list.filter((t) => t.take_id !== r.take_id),
        ]);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setUploadState('error');
        setUploadErr(msg);
        setUploadNote(`上传失败（${msg}）—— 录音还在这个页面上，别刷新。`);
      }
    },
    [item, configured, variant, status],
  );

  const onStartRecording = useCallback(() => {
    // 上一条 take 的 id 必须先清掉：不然「再录一遍」之后点评分，评的是上一段。
    setTakeId(null);
    setResult(null);
    setScoreNote('');
    setUploadNote('');
    setUploadState('idle');
    setUploadErr('');
    setAutoPlayMine(false);
    pendingRef.current = null;
    // mode 和版本都在这一刻冻住：她录完再去翻盖稿开关 / 切长短版，不能改这一遍的判定。
    setTakeMode(liveMode);
    setFrozenVersion(takeVersion);
    recordingItemId.current = item?.id ?? null;
    setRecNote('录着呢。说完按停止。');
    void recorder.start();
  }, [liveMode, takeVersion, recorder, item]);

  const onStop = useCallback(async () => {
    setStopping(true);
    let res;
    try {
      res = await recorder.stop();
    } catch (e) {
      // 停不下来也不能把导航永久锁死 —— 报一句，把闸放开。
      const msg = e instanceof Error ? e.message : String(e);
      setRecNote(`停止时出错：${msg}`);
      return;
    } finally {
      setStopping(false);
    }
    if (!res) return;
    // 这段声音是按下录音时那一条的。对不上就直接丢 —— 传错条目比丢一遍录音坏得多。
    const ownerId = recordingItemId.current;
    recordingItemId.current = null;
    if (ownerId && item && ownerId !== item.id) {
      setRecNote('这段录音属于上一条，已丢弃');
      return;
    }
    setMineUrl(res.playbackUrl);
    setCmp('mine');
    // 没有原声可比的时候，录完直接放自己一遍（recite.js 的 a_mine.play()）。
    setAutoPlayMine(!item?.has_orig);
    setRecNote(
      item?.has_orig ? '录完了 —— 先听自己一遍，再和面试原声来回比。' : '录完了 —— 听一遍自己。',
    );
    const body = res.blob ?? res.uri;
    if (body) {
      void doUpload({
        body,
        mimeType: res.mimeType,
        durationSec: res.durationSec,
        mode: takeMode,
        version: frozenVersion,
      });
    }
  }, [recorder, item, doUpload, takeMode, frozenVersion]);


  const onScore = useCallback(async () => {
    if (!takeId) {
      setScoreNote('还没有已存盘的录音。');
      return;
    }
    const scoredTakeId = takeId;
    setScoring(true);
    setScoreNote('转写 + 评分中…（云上冷启动可能要一分钟）');
    try {
      // mode 用录音那一刻冻住的，不是现在开关的位置 —— 她看见的 == 她被评的。
      const r = await rescore(scoredTakeId, { why_line: whyLine.trim(), mode: takeMode });
      setResult(r);
      setScoreNote('');
      setEverScored(true);
      // 箱位 / 录过次数 / 过关数都在 r.state 里，合回去，顶栏立刻是新的。
      const patch = (t: ReciteTakeSummary): ReciteTakeSummary =>
        t.take_id === scoredTakeId
          ? {
              ...t,
              total: r.total ?? t.total,
              verdict: r.verdict || t.verdict,
              passed: r.passed ?? t.passed,
            }
          : t;
      setStatus((s) =>
        s
          ? { ...s, state: { ...s.state, ...(r.state ?? {}) }, takes: (s.takes ?? []).map(patch) }
          : s,
      );
      setLocalTakes((list) => list.map(patch));
      markOverviewStale();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setScoreNote(`评分请求挂了（${msg}），录音已在盘上 —— 可以再点一次。`);
    } finally {
      setScoring(false);
    }
  }, [takeId, whyLine, takeMode]);

  /**
   * 离开这一页之前的闸：正在录 / 录了还没存上盘，都要先问一句。
   * 录音是绑在这一条上的 —— 走了这段音就没有归属了。
   */
  const leaveGuard = useCallback(
    (go: () => void) => {
      if (recorder.state === 'recording' || stopping) {
        askConfirm('还在录音。', '先按「■ 停止」，这一遍才会存进这一条。', () => {}, '知道了');
        return;
      }
      if (!(mineUrl && !takeId)) {
        go();
        return;
      }
      askConfirm('这一条还没存上盘，离开就没了。', '要么先点「重试上传」，要么确认离开。', go, '还是离开');
    },
    [mineUrl, takeId, recorder.state, stopping],
  );

  const doMark = useCallback(
    (action: 'needs_rewrite' | 'scope_thin', label: string) => {
      if (!item) return;
      // 标记也会把她送回总库，所以走同一道离开闸。
      leaveGuard(() =>
        askConfirm(`把这一条标成「${label}」？`, '标完会回到总库。', () => {
        setMarkNote(`正在标「${label}」…`);
        markItem(item.id, action)
          .then(() => {
            markOverviewStale();
            setMarkNote(`✓ 已标「${label}」，回总库…`);
            leaveTimer.current = setTimeout(onBack, 700);
          })
          .catch((e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e);
            setMarkNote(`✗ 标记没成功：${msg}`);
          });
        }),
      );
    },
    [item, onBack, leaveGuard],
  );

  if (!thread || !item || !mainItem) {
    return (
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <Pressable onPress={onBack}>
          <Text style={{ color: colors.accent, fontSize: 13 }}>← 总库</Text>
        </Pressable>
        <Text style={{ color: colors.ink, marginTop: 16 }}>找不到这一条：{threadId}</Text>
      </ScrollView>
    );
  }

  // 没分组时沿用旧口径的追问列表（同一段对话里挂在这题下面的）；有追问链就由段落自己表达。
  const followups = chainMode
    ? []
    : mainItem.dialog_followups.length
      ? mainItem.dialog_followups
      : mainItem.followup_q
        ? [{ x: mainItem.followup_q, s: 0 }]
        : [];
  const origSrc = item.has_orig ? origUrl(item.id) : null;
  const cmpSrc = cmp === 'orig' ? origSrc : cmp === 'mine' ? mineUrl : null;

  // 服务端返回的历次录音里可能已经含有刚上传的那一条，按 take_id 去重。
  const takes: ReciteTakeSummary[] = [];
  const seenTakes = new Set<string>();
  for (const t of [...localTakes, ...(status?.takes ?? [])]) {
    if (seenTakes.has(t.take_id)) continue;
    seenTakes.add(t.take_id);
    takes.push(t);
  }

  const shownMode: ReciteMode = recorder.state === 'idle' ? liveMode : takeMode;
  const versionLabel = versioned
    ? (() => {
        const opt = versions.find((v) => v.id === shownVersionId);
        return opt ? ` · ${opt.short}` : '';
      })()
    : '';
  const modeLine = dialogMode
    ? '这一遍：即兴答，不看稿（计箱位）'
    : (shownMode === 'recall' ? '这一遍：闭卷，计箱位' : '这一遍：开卷，只记录不计箱位') + versionLabel;
  const canRecord = statusPhase !== 'loading';

  // 版本开关：短版 1–2 分钟 / 长版 3–5 分钟（原稿只在没有 short 时出现）。
  // 只有一段就不画开关 —— 一个按不动的按钮只是噪音。
  // 手上有一遍没了结的 take 时锁住：这一遍念的是哪一版已经定死了。
  const versionControl =
    !dialogMode && versions.length >= 2 ? (
      <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {versions.map((v) => {
          const on = v.id === shownVersionId;
          return (
            <Pressable
              key={v.id}
              disabled={takePending}
              onPress={() => {
                setVersion(v.id);
                setScriptVersionPref(v.id);
              }}
              style={{
                flexGrow: 1,
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 8,
                borderWidth: 1,
                alignItems: 'center',
                opacity: takePending && !on ? 0.4 : 1,
                borderColor: on ? colors.accent : colors.line,
                backgroundColor: on ? colors.accentSoft : colors.card,
              }}
            >
              <Text style={{ fontSize: 13.5, color: on ? colors.accent : colors.ink }}>{v.label}</Text>
            </Pressable>
          );
        })}
      </View>
    ) : null;

  /**
   * 一段的「学习内容」：念稿 + 要点 + 中文对照 + 就地点评。
   * 单段 thread 时它就是原来的左栏；有追问链时每一段各渲染一份。
   */
  const studyBlock = (it: ReciteItem) => {
    // 只有「正在练」的那一段吃版本开关；其余段一律原稿。
    const armed = it.id === item.id;
    const script = armed ? resolved?.script ?? it.script : it.script;
    const gloss = armed ? resolved?.gloss ?? it.script_zh_gloss : it.script_zh_gloss;
    const scored = it.scored_idx.map((k) => it.points[k]).filter(Boolean);
    const extras = it.extra_idx.map((k) => it.points[k]).filter(Boolean);
    const note = it.delivery_notes.length
      ? it.delivery_notes[(armed ? st.n_takes ?? 0 : 0) % it.delivery_notes.length]
      : '';
    const canon = it.canon_spans.length ? (
      <View style={{ marginTop: 8 }}>
        <Small>这几处按原文，其余用你自己的话：{it.canon_spans.join(' · ')}</Small>
      </View>
    ) : null;
    return (
      <>

      <Panel>
        <PanelTitle
          text="📖 念稿全文"
          right={
            <Pressable onPress={() => setMasked((m) => !m)} hitSlop={6}>
              <Text style={{ fontSize: 12.5, color: masked ? colors.accent : colors.muted }}>
                {masked ? '☑' : '☐'} 盖稿（闭卷练，计过关/箱位）
              </Text>
            </Pressable>
          }
        />
        {script ? (
          masked ? (
            <>
              <View style={{ backgroundColor: colors.chip, borderRadius: 8, padding: 14 }}>
                <Small>稿子盖上了 —— 这一遍算闭卷（recall），会计过关和箱位。想看就把开关关掉。</Small>
              </View>
              {/* 盖稿了也得留着 canon 提示：闭卷要背的恰恰就是这几句 */}
              {canon}
            </>
          ) : (
            <>
              <Text style={{ fontSize: 15.5, lineHeight: 30, color: colors.ink }}>
                {splitCanon(script, it.canon_spans).map((seg, i) =>
                  seg.canon ? (
                    <Text key={i} style={{ backgroundColor: colors.amberBg, color: colors.amberInk }}>
                      {seg.text}
                    </Text>
                  ) : (
                    <Text key={i}>{seg.text}</Text>
                  ),
                )}
              </Text>
              {canon}
            </>
          )
        ) : (
          <Small>这条没有念稿 —— 听原声 + 看下面的点评，想清楚当时该怎么答，然后自己录一版。</Small>
        )}
      </Panel>

      {scored.length || extras.length ? (
        <Panel>
          <PanelTitle text="🗝 要点（说到这几点就够，用你自己的话）" />
          {scored.map((c, i) => (
            <Text key={`s${i}`} style={{ fontSize: 14, color: colors.ink, marginBottom: 5, lineHeight: 21 }}>
              · {c.text}
            </Text>
          ))}
          {extras.length ? (
            <Collapse summary={`追问时再用的 ${extras.length} 条（不计分）`}>
              {extras.map((c, i) => (
                <Text
                  key={`e${i}`}
                  style={{ fontSize: 14, color: colors.muted, marginBottom: 5, lineHeight: 21 }}
                >
                  · {c.text}
                </Text>
              ))}
            </Collapse>
          ) : null}
          {note ? (
            <View style={noteBox(colors)}>
              <Text style={{ fontSize: 13.5, color: colors.tealInk }}>🎯 这一遍注意：{note}</Text>
            </View>
          ) : null}
        </Panel>
      ) : null}

      {gloss ? (
        <Panel>
          <PanelTitle text="🈶 中文对照" />
          <Collapse summary="展开 / 收起" initialOpen>
            <Text style={{ fontSize: 14, color: colors.ink, lineHeight: 22 }}>{gloss}</Text>
          </Collapse>
        </Panel>
      ) : null}

      {it.critique_zh || it.orig_text || it.debrief_line || it.followup_q || it.why_q ? (
        <Panel>
          <PanelTitle text="📝 当时的就地点评" />
          {it.critique_zh ? (
            <View style={{ backgroundColor: colors.chip, borderRadius: 8, padding: 10 }}>
              <Text style={{ fontSize: 13.5, color: colors.ink, lineHeight: 21 }}>{it.critique_zh}</Text>
            </View>
          ) : null}
          {it.debrief_line ? (
            <View
              style={{
                marginTop: 9,
                backgroundColor: colors.amberBg,
                borderLeftWidth: 3,
                borderLeftColor: colors.amberInk,
                borderRadius: 6,
                paddingVertical: 6,
                paddingHorizontal: 10,
              }}
            >
              <Text style={{ fontSize: 13.5, color: colors.amberInk, lineHeight: 21 }}>
                面试官会写下的：{it.debrief_line}
              </Text>
            </View>
          ) : null}
          {it.orig_text ? (
            <Collapse summary={`🎧 我当时真的说的（原声转写${it.asr_dirty ? '，⚠️ ASR 有坏词' : ''}）`}>
              <Text style={{ fontSize: 13.5, color: colors.ink, lineHeight: 21 }}>{it.orig_text}</Text>
            </Collapse>
          ) : null}
          {it.followup_q && !it.dialog?.turns?.length ? (
            <Collapse summary="↪ 他接着追问的">
              <Text style={{ fontSize: 13.5, color: colors.ink, lineHeight: 21 }}>{it.followup_q}</Text>
            </Collapse>
          ) : null}
          {it.why_q ? (
            <Collapse summary="❓ 他随时可能插的一句">
              <Text style={{ fontSize: 13.5, color: colors.ink, lineHeight: 21 }}>{it.why_q}</Text>
            </Collapse>
          ) : null}
        </Panel>
      ) : null}
      </>
    );
  };

  // 完整对话一条 thread 只画一次（用主问题那一段的对话音频和逐句列表）。
  const dialogPanel = (it: ReciteItem) => {
    const dlgSrc = it.has_dialog ? dialogUrl(it.id) : null;
    const dialogSec = it.dialog ? it.dialog.t1 - it.dialog.t0 : 0;
    return (
      <>
      {it.dialog?.turns?.length ? (
        <Panel>
          <PanelTitle
            text="🎙 完整对话（提问 → 回答 → 追问全往返）"
            right={
              <Small>
                {Math.floor(dialogSec / 60)}分{`0${dialogSec % 60}`.slice(-2)}秒
              </Small>
            }
          />
          {it.has_dialog ? (
            <AudioTrack
              ref={dialogRef}
              label="🎧 这一段的完整原声 —— 点下面任意一句直接跳播"
              src={dlgSrc}
            />
          ) : null}
          <Small>绿底 = 面试官。他在哪里插话、追问了什么，就是上一段哪里没讲清楚。</Small>
          <View style={{ marginTop: 6 }}>
            {it.dialog.turns.map((t, i) => {
              const off = t.s > it.dialog!.t0 ? t.s - it.dialog!.t0 : 0;
              const iv = t.sp === 'iv';
              const who = iv
                ? '面试官'
                : it.source === 'reference'
                  ? it.speaker_name || '受访者'
                  : '我';
              return (
                <Pressable
                  key={i}
                  onPress={() => {
                    dialogRef.current?.seekTo(off);
                    dialogRef.current?.play();
                  }}
                  style={{
                    flexDirection: 'row',
                    gap: 9,
                    paddingVertical: 5,
                    paddingHorizontal: 6,
                    borderRadius: 8,
                    backgroundColor: iv ? colors.tealBg : 'transparent',
                  }}
                >
                  <Text
                    style={{ fontSize: 12, color: colors.muted, minWidth: 38, fontVariant: ['tabular-nums'] }}
                  >
                    {fmtClock(off)}
                  </Text>
                  <Text
                    style={{
                      fontSize: 13.5,
                      fontWeight: iv ? '600' : '400',
                      color: iv ? colors.tealInk : colors.muted,
                    }}
                  >
                    {who}
                  </Text>
                  <Text style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: colors.ink, lineHeight: 21 }}>
                    {t.x}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {it.dialog.truncated ? (
            <View style={{ marginTop: 6 }}>
              <Small>✂️ 离下一题还很远，这里截断在回答结束后 5 分钟处（中间多是与本题无关的推进）。</Small>
            </View>
          ) : null}
        </Panel>
      ) : null}
      </>
    );
  };

  // ══ 录音区：宽屏在右栏，窄屏顶到题目卡正下方 ══════════════════════════════
  const recordArea = (
    <>
      {/* 没有原声、也还没录，这一块就是个空壳 —— 不画，让录音键顶上来。
          对话流里更进一步：原声整段就在上面的逐句里，这块只会重复一遍，直接不画。 */}
      {!dialogMode && (item.has_orig || mineUrl) ? (
        <Panel>
          <PanelTitle text="🎚 音轨" />
          {item.has_orig ? <AudioTrack label="🎧 面试原声（我当时说的）" src={origSrc} /> : null}
          {mineUrl ? <AudioTrack label="🎤 我刚才的录音" src={mineUrl} autoPlay={autoPlayMine} /> : null}
        </Panel>
      ) : null}

      <Panel>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: 26, color: colors.ink, fontVariant: ['tabular-nums'] }}>
            {fmtClock(recorder.elapsedSec)}{' '}
            <Text style={{ fontSize: 13, color: colors.muted }}>目标 {targetSec}s</Text>
          </Text>
        </View>
        <View style={{ marginTop: 8 }}>
          <ProgressBar ratio={targetSec ? recorder.elapsedSec / targetSec : 0} />
        </View>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
          <Btn
            flex
            label={
              recorder.requesting
                ? '正在等麦克风授权…'
                : !canRecord
                  ? '正在取今天的说法…'
                  : recorder.state === 'recording'
                    ? '● 录 音 中'
                    : recorder.state === 'stopped'
                      ? '● 再 录 一 遍'
                      : '● 录 音'
            }
            tone={recorder.state === 'recording' ? 'recording' : 'record'}
            // 变体/目标秒数还没到手就录，X-Recite-Meta 里会是占位值 —— 那一遍等于评错了题面。
            disabled={recorder.state === 'recording' || !canRecord || recorder.requesting}
            onPress={onStartRecording}
          />
          <Btn flex label="■ 停 止" disabled={recorder.state !== 'recording'} onPress={() => void onStop()} />
        </View>

        <View style={{ marginTop: 8, alignItems: 'center' }}>
          <Text
            style={{
              fontSize: 12.5,
              color: shownMode === 'recall' ? colors.accent : colors.muted,
            }}
          >
            {modeLine}
          </Text>
        </View>

        {/* 上传结果长在录音面板上 —— 这是「录音到底存没存上」的唯一事实源。 */}
        {uploadState !== 'idle' ? (
          <View style={{ marginTop: 8, alignItems: 'center', gap: 6 }}>
            {uploadState === 'uploading' ? <Small>⋯ 录音上传中…</Small> : null}
            {uploadState === 'ok' ? (
              <Text style={{ fontSize: 13, color: colors.ok, fontWeight: '600' }}>✓ 录音已存盘</Text>
            ) : null}
            {uploadState === 'error' ? (
              <>
                <Text style={{ fontSize: 13, color: colors.bad, textAlign: 'center' }}>
                  ✗ 上传失败：{uploadErr}
                </Text>
                <Small color={colors.bad}>录音还在这个页面上，别刷新。</Small>
                <Btn
                  label="重试上传"
                  tone="primary"
                  small
                  onPress={() => {
                    const p = pendingRef.current;
                    if (p) void doUpload(p);
                  }}
                />
              </>
            ) : null}
          </View>
        ) : null}

        <View style={{ marginTop: 8 }}>
          <Small color={recorder.error ? colors.bad : undefined}>
            {recorder.error ??
              (dialogMode
                ? recNote
                : !item.has_orig && !mineUrl
                  ? '这条没有原声段 —— 直接录一版，再回听自己。'
                  : recNote)}
          </Small>
        </View>
      </Panel>

      {mineUrl && (item.has_orig || dialogMode) ? (
        <Panel>
          <PanelTitle text="🆚 对比（点谁播谁，来回 A/B）" />
          <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap', marginBottom: 8 }}>
            {item.has_orig ? (
              <Btn flex label="🎧 原声" tone={cmp === 'orig' ? 'primary' : 'ghost'} onPress={() => setCmp('orig')} />
            ) : null}
            <Btn flex label="🎤 我的" tone={cmp === 'mine' ? 'primary' : 'ghost'} onPress={() => setCmp('mine')} />
          </View>
          <AudioTrack key={cmpSrc ?? 'none'} src={cmpSrc} autoPlay />
        </Panel>
      ) : null}

      {mineUrl ? (
        <Panel>
          <PanelTitle text="🤖 AI 评分（可选，不点也不影响练）" />
          <TextInput
            value={whyLine}
            onChangeText={setWhyLine}
            multiline
            placeholder="（可选）一句话：这样做为什么是对的？写了 why_depth 才有分。"
            placeholderTextColor={colors.muted}
            style={{
              minHeight: 52,
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: 8,
              padding: 8,
              fontSize: 14,
              color: colors.ink,
              backgroundColor: colors.bg,
              textAlignVertical: 'top',
            }}
          />
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <Btn
              label={everScored ? '再评一次' : '让 AI 评一下'}
              tone="primary"
              disabled={scoring || !takeId}
              onPress={() => void onScore()}
            />
          </View>
          {scoreNote || uploadNote ? (
            <View style={{ marginTop: 6 }}>
              <Small>{scoreNote || uploadNote}</Small>
            </View>
          ) : null}
        </Panel>
      ) : null}

      {result ? <ScoreCard r={result} /> : null}
    </>
  );

  const takesPanel = takes.length ? (
    <Panel>
      <PanelTitle text="🗂 历次录音" />
      {takes.map((t) => (
        <View
          key={t.take_id}
          style={{
            flexDirection: 'row',
            gap: 8,
            alignItems: 'center',
            borderTopWidth: 1,
            borderTopColor: colors.line,
            paddingVertical: 6,
          }}
        >
          <Text style={{ fontSize: 12, color: colors.muted }}>
            {t.ts.length > 10 ? t.ts.slice(5, 16).replace('T', ' ') : t.ts}
          </Text>
          {/* 哪一遍念的是哪一版 —— 不标出来，历次录音里长短版混在一起就没法比 */}
          {t.version === 'short' || t.version === 'long' ? (
            <Text
              style={{
                fontSize: 11,
                lineHeight: 18,
                paddingHorizontal: 6,
                borderRadius: 20,
                overflow: 'hidden',
                backgroundColor: colors.accentSoft,
                color: colors.accent,
              }}
            >
              {t.version === 'long' ? '长' : '短'}
            </Text>
          ) : null}
          <AudioTrack compact src={t.audio_url || takeUrl(t.take_id)} />
          <Text style={{ fontSize: 12, color: colors.muted }}>
            {t.total != null ? t.total.toFixed(1) : '未评'}
          </Text>
        </View>
      ))}
    </Panel>
  ) : null;

  // ══ 段落（追问链）══════════════════════════════════════════════════════════
  const mainTitle = chainMode
    ? thread.thread.title || mainItem.question
    : variant.q || mainItem.question;
  const mainZhRaw = (chainMode ? thread.thread.title_zh || mainItem.question_zh : mainItem.question_zh) || '';
  const mainQuestionZh = mainZhRaw.trim() && mainZhRaw.trim() !== mainTitle.trim() ? mainZhRaw : '';

  /** 一个渲染块 = 一个「主段」+ 并进来的短追问 */
  interface SegGroup {
    lead: ResolvedSegment;
    merged: ResolvedSegment[];
  }
  const segmentGroups: SegGroup[] = [];
  for (const seg of thread.segments) {
    // merge_into_prev 的短追问并进上一块；点过「单练」的会被拎出来自成一块。
    if (seg.merged && !soloIds.has(seg.item.id) && segmentGroups.length) {
      segmentGroups[segmentGroups.length - 1].merged.push(seg);
    } else {
      segmentGroups.push({ lead: seg, merged: [] });
    }
  }

  /** 换「正在练」的那一段 = 换 take 的归属，所以走同一道离开闸。 */
  const armSegment = (id: string) => {
    if (id === armedId) return;
    leaveGuard(() => setArmedId(id));
  };

  const segAudio = (it: ReciteItem) => {
    const src = it.has_orig ? origUrl(it.id) : null;
    if (!src) return null;
    const on = segAudioId === it.id;
    return (
      <>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          <Btn
            small
            label={on ? '⏹ 收起原声' : '▶ 听我当时说的'}
            tone={on ? 'primary' : 'ghost'}
            onPress={() => setSegAudioId(on ? null : it.id)}
          />
        </View>
        {/* 一个播放器，点哪一段就换到哪一段的源（她一次只会听一段） */}
        {on ? (
          <View style={{ marginTop: 6 }}>
            <AudioTrack key={it.id} src={src} autoPlay />
          </View>
        ) : null}
      </>
    );
  };

  // ══ 对话流：真实面试的题，整页就是当时的一来一回 ═══════════════════════════
  /** 一条 thread 共用一个播放器；点哪一段的句子就把源换到哪一段 */
  const activeDlgId = dlgAudioId ?? mainItem.id;
  const playTurn = (it: ReciteItem, off: number) => {
    setDlgAudioId(it.id);
    setSeek((prev) => ({ seq: prev.seq + 1, at: off }));
  };

  /** 一段的逐句原文：时间戳 · 谁在说 · 英文原话 · 中文（翻译管线补上之前没有） */
  const transcriptFor = (it: ReciteItem) => {
    const turns = it.dialog?.turns ?? [];
    if (!turns.length) {
      return <Small>这一段没有留下逐句原文。</Small>;
    }
    const t0 = it.dialog?.t0 ?? 0;
    return (
      <View>
        {turns.map((turn, i) => {
          const off = turn.s > t0 ? turn.s - t0 : 0;
          const iv = turn.sp === 'iv';
          const who = iv
            ? '面试官'
            : it.source === 'reference'
              ? it.speaker_name || '受访者'
              : '我';
          return (
            <Pressable
              key={i}
              onPress={() => playTurn(it, off)}
              style={{
                flexDirection: 'row',
                gap: 9,
                paddingVertical: 7,
                paddingHorizontal: 7,
                borderRadius: 8,
                backgroundColor: iv ? colors.tealBg : 'transparent',
              }}
            >
              <Text
                style={{ fontSize: 12, color: colors.muted, minWidth: 38, fontVariant: ['tabular-nums'] }}
              >
                {fmtClock(off)}
              </Text>
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: iv ? '600' : '400',
                  color: iv ? colors.tealInk : colors.muted,
                  minWidth: 38,
                }}
              >
                {who}
              </Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 14, color: colors.ink, lineHeight: 22 }}>{turn.x}</Text>
                {turn.zh ? (
                  <Text style={{ fontSize: 12.5, color: colors.muted, lineHeight: 20, marginTop: 2 }}>
                    {turn.zh}
                  </Text>
                ) : null}
              </View>
              <Text style={{ fontSize: 12, color: colors.accent }}>▶</Text>
            </Pressable>
          );
        })}
      </View>
    );
  };

  /** 三遍练习法勾选框：每段一排 ☐跟读 ☐闭眼 ☐掐表。勾了立即存云端（失败进本地队列自动补传）。 */
  const practiceRow = (it: ReciteItem) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
      <Small>三遍</Small>
      {PRACTICE_STEPS.map((s) => {
        const on = practiceVal(it.id, s.key) != null;
        return (
          <Pressable
            key={s.key}
            onPress={() => togglePractice(it.id, s.key)}
            hitSlop={8}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={`${s.label}（${s.hint}）`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
          >
            <Text style={{ fontSize: 16, color: on ? colors.accent : colors.muted }}>
              {on ? '☑' : '☐'}
            </Text>
            <Text style={{ fontSize: 12.5, color: on ? colors.ink : colors.muted }}>{s.label}</Text>
          </Pressable>
        );
      })}
      {practicePending ? <Small>⏳ 有勾还没同步，联网后自动补传</Small> : null}
    </View>
  );

  const dialogSegmentBlock = ({ lead, merged }: SegGroup) => {
    const it = lead.item;
    const armed = it.id === item.id;
    // merge_into_prev 的短追问在这里就是「接着往下的几句」，直接续在同一块里。
    const parts = [lead, ...merged];
    return (
      <View
        key={it.id}
        style={{
          borderLeftWidth: 3,
          borderLeftColor: armed ? colors.accent : colors.line,
          paddingLeft: 12,
          marginBottom: 18,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Text
            style={{
              fontSize: 11.5,
              lineHeight: 18,
              paddingHorizontal: 7,
              borderRadius: 20,
              overflow: 'hidden',
              backgroundColor: lead.segment.role === 'main' ? colors.accentSoft : colors.tealBg,
              color: lead.segment.role === 'main' ? colors.accent : colors.tealInk,
            }}
          >
            {lead.segment.label}
          </Text>
          {it.target_sec ? <Small>{segmentSecLabel(it.target_sec)}</Small> : null}
          <View style={{ marginLeft: 'auto' }}>
            {armed ? (
              <Text style={{ fontSize: 12.5, color: colors.accent }}>● 正在练这一段</Text>
            ) : (
              <Btn small label="练这一段" disabled={busy} onPress={() => armSegment(it.id)} />
            )}
          </View>
        </View>

        {/* 播放器一条 thread 只有一个：点哪一段的句子，源就换到哪一段 */}
        {activeDlgId === it.id ? (
          <View style={{ marginTop: 8 }}>
            <AudioTrack
              key={it.id}
              label="🎧 这一段的完整原声 —— 点下面任意一句直接跳播"
              src={it.has_dialog ? dialogUrl(it.id) : null}
              startAt={seek.at}
              seekSeq={seek.seq}
            />
          </View>
        ) : null}

        <View style={{ marginTop: 6 }}>
          {parts.map((part, k) => (
            <View key={part.item.id}>
              {k > 0 ? (
                <View style={{ marginTop: 10, marginBottom: 2 }}>
                  <Small>{part.segment.label}</Small>
                </View>
              ) : null}
              {transcriptFor(part.item)}
              {/* 并进来的短追问也是独立条目，三遍统计按条目算——每段都要有自己的勾 */}
              {practiceRow(part.item)}
            </View>
          ))}
        </View>

        {armed ? (
          <View style={{ marginTop: 12 }}>
            {recordArea}
            {takesPanel}
          </View>
        ) : null}
      </View>
    );
  };

  const scriptSegmentBlock = ({ lead, merged }: SegGroup) => {
    const it = lead.item;
    const armed = it.id === item.id;
    const zh = (it.question_zh || '').trim();
    return (
      <View
        key={it.id}
        style={{
          borderLeftWidth: 3,
          borderLeftColor: armed ? colors.accent : colors.line,
          paddingLeft: 12,
          marginBottom: 18,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Text
            style={{
              fontSize: 11.5,
              lineHeight: 18,
              paddingHorizontal: 7,
              borderRadius: 20,
              overflow: 'hidden',
              backgroundColor: lead.segment.role === 'main' ? colors.accentSoft : colors.tealBg,
              color: lead.segment.role === 'main' ? colors.accent : colors.tealInk,
            }}
          >
            {lead.segment.label}
          </Text>
          {it.target_sec ? <Small>{segmentSecLabel(it.target_sec)}</Small> : null}
          <View style={{ marginLeft: 'auto' }}>
            {armed ? (
              <Text style={{ fontSize: 12.5, color: colors.accent }}>● 正在练这一段</Text>
            ) : (
              <Btn small label="练这一段" disabled={busy} onPress={() => armSegment(it.id)} />
            )}
          </View>
        </View>

        <Text style={{ fontSize: 15, fontWeight: '600', color: colors.ink, marginTop: 6, lineHeight: 23 }}>
          {it.question}
        </Text>
        {zh && zh !== (it.question || '').trim() ? (
          <Text style={{ fontSize: 13, color: colors.muted, marginTop: 2, lineHeight: 20 }}>{zh}</Text>
        ) : null}

        {segAudio(it)}

        {it.orig_text ? (
          <Collapse summary="🎧 我当时说的">
            <Text style={{ fontSize: 13.5, color: colors.ink, lineHeight: 21 }}>{it.orig_text}</Text>
          </Collapse>
        ) : null}

        <View style={{ marginTop: 10 }}>{studyBlock(it)}</View>
        {practiceRow(it)}

        {/* 很短的追问并在这一块里：问题 + ▶ + 我当时说的，不给自己的稿和录音面板 */}
        {merged.map((m) => (
          <View
            key={m.item.id}
            style={{
              marginTop: 4,
              paddingTop: 8,
              borderTopWidth: 1,
              borderTopColor: colors.line,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Small>{m.segment.label}</Small>
              <Pressable onPress={() => setSoloIds((x) => new Set([...x, m.item.id]))} hitSlop={6}>
                <Text style={{ fontSize: 12, color: colors.accent }}>单练</Text>
              </Pressable>
            </View>
            <Text style={{ fontSize: 13.5, color: colors.ink, marginTop: 2, lineHeight: 21 }}>
              {m.item.question}
            </Text>
            {m.item.question_zh ? <Small>{m.item.question_zh}</Small> : null}
            {segAudio(m.item)}
            {m.item.orig_text ? (
              <Collapse summary="🎧 我当时说的">
                <Text style={{ fontSize: 13.5, color: colors.ink, lineHeight: 21 }}>{m.item.orig_text}</Text>
              </Collapse>
            ) : null}
            {practiceRow(m.item)}
          </View>
        ))}

        {/* 录音/上传/评分/历次录音只长在「正在练」的那一段下面 */}
        {armed ? (
          <View style={{ marginTop: 12 }}>
            {recordArea}
            {takesPanel}
          </View>
        ) : null}
      </View>
    );
  };

  const segmentBlock = (group: SegGroup) =>
    dialogMode ? dialogSegmentBlock(group) : scriptSegmentBlock(group);

  const right = (
    <View style={{ flex: 1, minWidth: 0 }}>
      {recordArea}
      {takesPanel}
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      {/* 顶栏钉在上面：一段长对话滚下去几屏之后，「← 总库」和「下一条」不能跟着滚没。 */}
      <View style={[styles.top, { borderBottomColor: colors.line, backgroundColor: colors.bg }]}>
        <Pressable onPress={() => leaveGuard(onBack)} hitSlop={8} disabled={busy}>
          <Text style={{ fontSize: 13, color: colors.accent, opacity: busy ? 0.4 : 1 }}>← 总库</Text>
        </Pressable>
        <Text style={{ fontSize: 15, fontWeight: '600', color: colors.ink, flex: 1, minWidth: 180 }}>
          {thread.interview || mainItem.company}
          {sibs.length ? ` · 第 ${idx + 1}/${sibs.length} 条` : ''}
        </Text>
        {item.source === 'reference' ? (
          <Text
            style={{
              fontSize: 12.5,
              color: colors.accent,
              backgroundColor: colors.accentSoft,
              borderRadius: 7,
              paddingHorizontal: 9,
              paddingVertical: 2,
              overflow: 'hidden',
            }}
          >
            🎧 他人实录{item.speaker_name ? `·${item.speaker_name}` : ''} — 参考件，听打法用
          </Text>
        ) : null}
        <Text style={{ fontSize: 12.5, color: colors.muted, fontVariant: ['tabular-nums'] }}>
          目标 {targetSec}s{chainMode ? ` · 全链 ${thread.targetSec}s` : ''} · box {st.box ?? 1} · 录过{' '}
          {nRecorded} 次
        </Text>
        <View style={{ flexDirection: 'row', gap: 5 }}>
          {/* 录音期间这一条被钉住：走了这段音就没有归属了 */}
          {prev ? (
            <Btn
              label="← 上一条"
              disabled={busy}
              onPress={() => leaveGuard(() => onOpen(prev.thread.thread_id))}
            />
          ) : null}
          {next ? (
            <Btn
              label="下一条 →"
              disabled={busy}
              onPress={() => leaveGuard(() => onOpen(next.thread.thread_id))}
            />
          ) : null}
      </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 60 }}>
        {statusNote ? (
          <View style={{ backgroundColor: colors.amberBg, borderRadius: 9, padding: 9, marginBottom: 10 }}>
            <Text style={{ fontSize: 12.5, color: colors.amberInk }}>{statusNote}</Text>
          </View>
        ) : null}

        {/* 题目卡 */}
        <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.line }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text style={{ fontSize: 12, color: colors.muted, fontWeight: '600', letterSpacing: 0.5 }}>
              {dialogMode ? '当时的原话' : 'MAIN QUESTION'}
            </Text>
            {/* 判稿的两个开关不该藏在评分面板里 —— 她常常是看一眼就知道这稿要改，根本不用录。 */}
            <View style={{ flexDirection: 'row', gap: 6, marginLeft: 'auto' }}>
              <Btn small label="这稿要改" disabled={busy} onPress={() => doMark('needs_rewrite', '稿要改')} />
              <Btn small label="量级不足" disabled={busy} onPress={() => doMark('scope_thin', '量级不足')} />
            </View>
          </View>
          {markNote ? (
            <View style={{ marginTop: 6 }}>
              <Small color={markNote.startsWith('✗') ? colors.bad : colors.ok}>{markNote}</Small>
            </View>
          ) : null}
          {/* 对话流里第一句就是面试官在问，标题再抄一遍是重复 —— 只留中文一行定位。 */}
          {dialogMode ? null : (
            <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink, marginTop: 4, lineHeight: 24 }}>
              {chainMode ? thread.thread.title || mainItem.question : variant.q || mainItem.question}
            </Text>
          )}
          {/* playbook 条目的 question 本身就是中英合写的，再原样重复一遍中文是噪音 */}
          {dialogMode ? (
            thread.thread.title_zh || mainItem.question_zh ? (
              <Text style={{ fontSize: 14, color: colors.ink, marginTop: 4, lineHeight: 22 }}>
                {thread.thread.title_zh || mainItem.question_zh}
              </Text>
            ) : null
          ) : mainQuestionZh ? (
            <Text style={{ fontSize: 13.5, color: colors.muted, marginTop: 3, lineHeight: 21 }}>
              {mainQuestionZh}
            </Text>
          ) : null}
          {/* 她要练的正是这个：他为什么一直往下问、她在哪儿把人讲丢了。 */}
          {!dialogMode && thread.thread.chain_note_zh ? (
            <View
              style={{
                marginTop: 9,
                backgroundColor: colors.amberBg,
                borderRadius: 8,
                paddingVertical: 8,
                paddingHorizontal: 11,
              }}
            >
              <Text style={{ fontSize: 12.5, color: colors.amberInk, fontWeight: '600', marginBottom: 2 }}>
                他为什么一直追问
              </Text>
              <Text style={{ fontSize: 13.5, color: colors.amberInk, lineHeight: 21 }}>
                {thread.thread.chain_note_zh}
              </Text>
            </View>
          ) : null}
          {!dialogMode && variant.type !== 'original' ? (
            <Text style={{ fontSize: 13, color: colors.amberInk, marginTop: 5 }}>
              🔀 今天这条也可以换个说法练 —— {variant.type}：{variant.hint}
            </Text>
          ) : null}
          {!dialogMode && followups.length ? (
            <View style={{ marginTop: 11, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 9 }}>
              <Small>这不是新题，是同一段对话里接在这个问题下面的追问。</Small>
              {followups.map((f, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 8, paddingVertical: 7 }}>
                  <Text style={{ fontSize: 12.5, color: colors.accent, width: 94 }}>Follow-up {i + 1}</Text>
                  <Text style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: colors.ink, lineHeight: 21 }}>
                    {f.x}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {flowMode ? (
          // 对话流 / 追问链：一段一段往下铺，录音面板长在「正在练」的那一段下面。
          // 对话流里逐句原文本身就是完整对话，底下不再重复一个「完整对话」面板。
          <View style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            {versionControl}
            {segmentGroups.map((group) => segmentBlock(group))}
            {dialogMode ? null : dialogPanel(mainItem)}
          </View>
        ) : twoCol ? (
          <View style={{ flexDirection: 'row', gap: 16, alignItems: 'flex-start' }}>
            <View style={{ flex: 1.25, minWidth: 0 }}>
              {versionControl}
              {studyBlock(mainItem)}
              {practiceRow(mainItem)}
              {dialogPanel(mainItem)}
            </View>
            {right}
          </View>
        ) : (
          // 窄屏：录音区顶到题目卡正下方，稿子跟在后面，历次录音收到最底下。
          <View style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            {versionControl}
            {recordArea}
            {studyBlock(mainItem)}
            {practiceRow(mainItem)}
            {dialogPanel(mainItem)}
            {takesPanel}
          </View>
        )}
      </ScrollView>

      {/* 录音中的窄屏：底部钉一条，好让她一边往下读稿一边随时停。 */}
      {!twoCol && recorder.state === 'recording' ? (
        <View style={[styles.pinnedBar, { backgroundColor: colors.card, borderTopColor: colors.line }]}>
          <Text style={{ fontSize: 18, color: colors.ink, fontVariant: ['tabular-nums'] }}>
            {fmtClock(recorder.elapsedSec)}{' '}
            <Text style={{ fontSize: 12.5, color: colors.muted }}>/ 目标 {targetSec}s</Text>
          </Text>
          <View style={{ marginLeft: 'auto' }}>
            <Btn label="■ 停 止" tone="record" onPress={() => void onStop()} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** 评分卡 —— recite.js 的 render() 逐块搬过来。 */
function ScoreCard({ r }: { r: ReciteScoreResult }) {
  const { colors } = useTheme();
  const s = r.scores ?? {};
  const rows: Array<[string, number | null | undefined]> = [
    ['覆盖（代码算）', r.coverage],
    ['结构', s.structure],
    ['句子', s.concision],
    ['口条', s.fluency],
    ['为什么', s.why_depth],
  ];
  const m = r.metrics;
  const asrLine = m?.asr_error
    ? `⚠️ 转写失败：${m.asr_error} —— 录音已存，可以再评一次。`
    : m
      ? `引擎 ${m.asr_engine || '?'} · ${(m.duration || 0).toFixed(0)}s · ${m.wpm || 0} wpm · >2s 停顿 ${
          m.pauses_over_2s || 0
        } 次 · 填充词（参考值，不进判定）${(m.hard_filler || 0) + (m.soft_filler || 0)}`
      : '';
  let rLine = `📎 逐字重合 ${r.verbatim_ratio != null ? r.verbatim_ratio : '—'}`;
  if (r.r_prev != null) rLine += ` · 和你上一次的重合 ${r.r_prev}`;
  rLine += r.r_is_flag ? '（这一档会看它）' : '（这一档仅记录，不是指控）';

  return (
    <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.line }]}>
      <Text style={{ fontSize: 21, fontWeight: '700', color: colors.ink }}>
        {r.verdict || '—'}{' '}
        <Text style={{ fontSize: 14, fontWeight: '400', color: colors.muted }}>
          {r.total != null ? `← ${r.total} / 5` : ''}
        </Text>
      </Text>
      {r.calibrating ? <Small>过关线校准中 —— 这一次不改箱位。</Small> : null}
      {r.gate_note ? (
        <View style={{ marginTop: 6 }}>
          <Small>{r.gate_note}</Small>
        </View>
      ) : null}

      <View style={{ marginVertical: 9 }}>
        {rows
          .filter(([, v]) => v != null)
          .map(([label, v]) => (
            <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
              <Text style={{ fontSize: 13.5, color: colors.ink }}>{label}</Text>
              <Text style={{ fontSize: 13.5, color: colors.ink, letterSpacing: 2 }}>
                {dots(v)} {v}
              </Text>
            </View>
          ))}
      </View>

      {(r.red_flags ?? []).map((x, i) => (
        <View key={`f${i}`} style={[styles.flag, { backgroundColor: colors.badBg }]}>
          <Text style={{ fontSize: 13.5, color: colors.bad }}>🚩 {x}</Text>
        </View>
      ))}
      {r.judge_error ? (
        <View style={[styles.flag, { backgroundColor: colors.badBg }]}>
          <Text style={{ fontSize: 13.5, color: colors.bad }}>
            评分没跑出来（{r.judge_error}），录音已存。
          </Text>
        </View>
      ) : null}

      {(r.fact_check ?? []).map((c, i) => (
        <View key={`c${i}`} style={[styles.flag, { backgroundColor: colors.amberBg }]}>
          <Text style={{ fontSize: 13, color: colors.amberInk }}>
            📋 「{c.said}」 {c.note}
            {c.provenance ? `\n${c.provenance}` : ''} （事实核对不进分数）
          </Text>
        </View>
      ))}

      {(r.missed_cues ?? []).length ? (
        <Text style={{ fontSize: 13.5, color: colors.bad, lineHeight: 21 }}>
          {r.missed_cues.map((mc) => `❌ 没说到：「${mc}」`).join('\n')}
        </Text>
      ) : null}

      {r.fix_next ? (
        <View
          style={{
            marginTop: 10,
            backgroundColor: colors.amberBg,
            borderLeftWidth: 3,
            borderLeftColor: colors.amberInk,
            borderRadius: 6,
            paddingVertical: 6,
            paddingHorizontal: 10,
          }}
        >
          <Text style={{ fontSize: 13.5, color: colors.amberInk }}>
            ▸ 下一遍只改这一件事：{r.fix_next}
          </Text>
        </View>
      ) : null}
      {r.one_line ? (
        <View style={{ marginTop: 6 }}>
          <Small>{r.one_line}</Small>
        </View>
      ) : null}

      <Collapse summary="🗣 转写：我刚才说的">
        <View style={{ backgroundColor: colors.chip, borderRadius: 8, padding: 10 }}>
          <Text style={{ fontSize: 13.5, color: colors.ink, lineHeight: 21 }}>
            {r.transcript || '（转写没跑出来）'}
          </Text>
        </View>
        {asrLine ? (
          <View style={{ marginTop: 6 }}>
            <Small>{asrLine}</Small>
          </View>
        ) : null}
        <View style={{ marginTop: 6 }}>
          <Small>{rLine}</Small>
        </View>
      </Collapse>
    </View>
  );
}

const styles = StyleSheet.create({
  top: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    flexWrap: 'wrap',
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 9,
  },
  panel: { borderWidth: 1, borderRadius: 10, paddingVertical: 13, paddingHorizontal: 15, marginBottom: 12 },
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  btn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSmall: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 7 },
  flag: { borderRadius: 8, paddingVertical: 8, paddingHorizontal: 11, marginBottom: 8 },
  pinnedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
});
