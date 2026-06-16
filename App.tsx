import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, SafeAreaView, Share, StatusBar as RNStatusBar, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import bundledCardsJson from './src/content/deck.bundle.json';
import seedTracksJson from './src/content/tracks.json';
import reciteBundleJson from './src/content/recite.bundle.json';
import reciteThreadsJson from './src/content/recite.threads.json';
import {
  dayActivity,
  deleteTrack,
  distinctCardsOnDay,
  loadElapsedSamples,
  loadFeedback,
  loadSettingsKv,
  loadSrs,
  loadTracks,
  openDb,
  saveSettingsKv,
  saveTrack,
  seedTracksOnce,
  studiedDays,
  type Db,
  type SyncSnapshot,
} from './src/db/database';
import { MASTERED_STABILITY_DAYS, RHYTHMS } from './src/config';
import { localDateStr } from './src/logic/dates';
import { buildFeedbackExport } from './src/logic/feedback';
import { ALL_CATEGORY, buildCategoryStats, filterByCategory } from './src/logic/categories';
import { buildQueue, buildWeakSweepQueue, introducedTodayCount, isDueNow, laterTodayCount, orderSessionQueue } from './src/logic/queue';
import { deadlineFloorDays, isFinalStretch, planNewPerDay } from './src/logic/planner';
import { DEFAULT_SETTINGS, settingsFromKv, settingsToKv } from './src/logic/settings';
import { setRequestRetention, State } from './src/logic/srs';
import { computeStreak, dailyGoal } from './src/logic/streak';
import {
  defaultTypicalTimes,
  dueByTomorrowCount,
  estimateMinutes,
  MAX_COUNTED_MS_PER_CARD,
  minutesFromMs,
  planChunk,
  typicalTimesByType,
  type TypicalTimes,
} from './src/logic/gameFeel';
import { preloadSfx } from './src/feel';
import { ALL_TRACK, cardMatchesTrack, filterDeck, findTrack } from './src/logic/tracks';
import {
  CLASSIC_SYSTEM_DESIGN_TRACK_ID,
  filterSystemDesignRoadmapStage,
  legacyTrackToRoadmapStage,
  normalizeSystemDesignRoadmapStage,
  SYSTEM_DESIGN_ROADMAP,
} from './src/logic/systemDesignRoadmap';
import { rescheduleReminders } from './src/notifications';
import { useTheme } from './src/theme';
import { syncConfigured, syncNow } from './src/sync';
import type { AppSettings, Card, Track } from './src/types';
import { DoneScreen } from './src/screens/DoneScreen';
import { SessionScreen, type SessionStats, type SessionStore } from './src/screens/SessionScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { TodayScreen, type TodayStats } from './src/screens/TodayScreen';
import { ReciteLibraryScreen } from './src/screens/ReciteLibraryScreen';
import { ReciteItemScreen } from './src/screens/ReciteItemScreen';
import { buildThreads } from './src/recite/threads';
import type { ReciteItem, ReciteThread } from './src/recite/types';

const bundledCards = bundledCardsJson as unknown as Card[];
const seedTracks = seedTracksJson as unknown as Track[];
// 念稿库和 12k 张卡一样打进 bundle：离线也能读题、看点评、看完整对话。
// 只有录音 / 转写 / 判官那一段要联网（docs/M4-recite.md §1）。
const reciteItems = reciteBundleJson as unknown as ReciteItem[];
// 库和练习页的单位是 thread（主问题 + 追问链）。分组表还没填满时，没被收走的条目
// 各自派生成一条单段 thread —— 336 条一条不丢（src/recite/threads.ts）。
const reciteThreads = buildThreads(reciteItems, reciteThreadsJson as unknown as ReciteThread[]);

type Screen = 'loading' | 'error' | 'today' | 'session' | 'done' | 'settings' | 'recite' | 'recite-item';
type SessionMode = 'all' | 'review' | 'new';
type SyncState = 'idle' | 'syncing' | 'success' | 'error';

function syncSummary(snapshot: SyncSnapshot): string {
  const reviewedCards = new Set(snapshot.reviews.map((review) => review.cardId)).size;
  return `同步完成：${snapshot.srs.length} 张已排期，${reviewedCards} 张有作答记录，${snapshot.reviews.length} 次作答。`;
}

function downloadTextFile(filename: string, text: string): boolean {
  if (typeof document === 'undefined') return false;

  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return true;
}

export default function App() {
  const { colors } = useTheme();
  const [screen, setScreen] = useState<Screen>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [todayStats, setTodayStats] = useState<TodayStats | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [sessionQueue, setSessionQueue] = useState<string[]>([]);
  /** deck snapshot for the running session — bounds the mid-session requeue sweep to the active track */
  const [sessionDeck, setSessionDeck] = useState<Card[]>([]);
  /** for 'review'/'new' sessions: the id set the requeue sweep may draw from (null = whole deck) */
  const [sessionScope, setSessionScope] = useState<Set<string> | null>(null);
  const [sessionReviewedToday, setSessionReviewedToday] = useState<Set<string>>(new Set());
  const [sessionKey, setSessionKey] = useState(0);
  const [lastStats, setLastStats] = useState<SessionStats>({ answered: 0, correct: 0, learned: 0 });
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [syncMessage, setSyncMessage] = useState('');
  /** 正在练的那一条链（thread_id）；'recite-item' 屏用它 */
  const [reciteThreadId, setReciteThreadId] = useState<string | null>(null);

  const dbRef = useRef<Db | null>(null);
  const cardsRef = useRef<Card[]>([]);
  const storeRef = useRef<SessionStore | null>(null);
  const settingsRef = useRef<AppSettings>(DEFAULT_SETTINGS);
  const tracksRef = useRef<Track[]>([]);
  const todayDoneIdsRef = useRef<Set<string>>(new Set());
  const cardsByIdRef = useRef<Map<string, Card>>(new Map());
  /** A1：各卡型她自己的作答用时中位数，启动时从 review_log 算一次 */
  const typicalRef = useRef<TypicalTimes>(defaultTypicalTimes());

  const pickerTracks = useCallback((): Track[] => [ALL_TRACK, ...tracksRef.current], []);

  const activeTrackDeck = useCallback((): Card[] => {
    const settings = settingsRef.current;
    const track = findTrack(pickerTracks(), settings.activeTrackId);
    const trackDeck = filterDeck(cardsRef.current, track);
    return settings.activeTrackId === CLASSIC_SYSTEM_DESIGN_TRACK_ID
      ? filterSystemDesignRoadmapStage(trackDeck, settings.activeRoadmapStage)
      : trackDeck;
  }, [pickerTracks]);

  const activeDeck = useCallback(
    (): Card[] => filterByCategory(activeTrackDeck(), settingsRef.current.activeCategory),
    [activeTrackDeck],
  );

  const refresh = useCallback(async () => {
    const db = dbRef.current;
    const store = storeRef.current;
    if (!db || !store) return;
    const now = new Date();
    const s = settingsRef.current;
    const trackDeck = activeTrackDeck();
    const categoryStats = buildCategoryStats(trackDeck, store.srs);
    const validCategory =
      s.activeCategory === ALL_CATEGORY || categoryStats.some((category) => category.id === s.activeCategory)
        ? s.activeCategory
        : ALL_CATEGORY;
    const deck = filterByCategory(trackDeck, validCategory);
    const deckIds = new Set(deck.map((c) => c.id));
    const trackDeckIds = new Set(trackDeck.map((c) => c.id));
    const doneSetAll = await distinctCardsOnDay(db, localDateStr(now));
    todayDoneIdsRef.current = doneSetAll;
    const reviewedTodayInDeck = new Set([...doneSetAll].filter((id) => deckIds.has(id)));

    let mastered = 0;
    let trackMastered = 0;
    let trackSeen = 0;
    for (const [id, e] of store.srs.entries()) {
      const isMastered = e.fsrs.state === State.Review && e.fsrs.stability >= MASTERED_STABILITY_DAYS;
      if (trackDeckIds.has(id)) {
        trackSeen++;
        if (isMastered) trackMastered++;
      }
      if (deckIds.has(id) && isMastered) mastered++;
    }

    const plan = planNewPerDay({ targetDate: s.targetDate, deckSize: deck.length, mastered, now });
    // A focused module (specific category) is a small finite set — the user
    // wants to finish it in one go, so the daily new-card quota only applies
    // to the "全部" view where the planner paces the whole track.
    const focusedModule = validCategory !== ALL_CATEGORY;
    // M3 §3.2 Phase 3: in the final stretch the "全部" view stops new cards and
    // drills the weak set; the correct-fuzzy floor drops to 1 so weak cards recycle fast.
    const finalStretch = !focusedModule && isFinalStretch(plan.daysLeft);
    const effectiveNewPerDay = focusedModule ? deck.length : finalStretch ? 0 : plan.newPerDay;
    // M3 §3.2 Phase 2: deadline-scaled floor for a "correct + 模糊" card.
    const correctFuzzyFloor = finalStretch ? 1 : deadlineFloorDays(effectiveNewPerDay);
    const queue = finalStretch
      ? buildWeakSweepQueue(deck, store.srs, { reviewedToday: reviewedTodayInDeck })
      : buildQueue(deck, store.srs, now, {
          newPerDay: effectiveNewPerDay,
          reviewedToday: reviewedTodayInDeck,
        });
    const dueCount = queue.filter((id) => store.srs.has(id)).length;
    const newCount = queue.length - dueCount;
    // A5：首页只报「这一组」——队列再长也最多 PLAN_CHUNK 张，剩下的不提；没做完的明天照样到期，
    // 按「最早到期先做」自然摊到之后几天（补课模式，FSRS 排期一点没动）。
    const planIds = planChunk(queue);
    const planMinutes = estimateMinutes(planIds, cardsByIdRef.current, typicalRef.current);
    const activity = await dayActivity(db, localDateStr(now), MAX_COUNTED_MS_PER_CARD);

    const doneInDeck = reviewedTodayInDeck.size;
    const quotaLeft = Math.max(0, effectiveNewPerDay - introducedTodayCount(store.srs, now, deckIds));
    const goal = dailyGoal(doneInDeck, dueCount, Math.min(quotaLeft, newCount));

    const streak = computeStreak(await studiedDays(db), now);

    const roadmapStages =
      s.activeTrackId === CLASSIC_SYSTEM_DESIGN_TRACK_ID
        ? SYSTEM_DESIGN_ROADMAP.map((stage) => {
            const stageDeck = filterSystemDesignRoadmapStage(
              filterDeck(cardsRef.current, findTrack(pickerTracks(), CLASSIC_SYSTEM_DESIGN_TRACK_ID)),
              stage.id,
            );
            let seen = 0;
            let stageMastered = 0;
            for (const card of stageDeck) {
              const entry = store.srs.get(card.id);
              if (entry) seen++;
              if (entry?.fsrs.state === State.Review && entry.fsrs.stability >= MASTERED_STABILITY_DAYS) {
                stageMastered++;
              }
            }
            return { ...stage, total: stageDeck.length, seen, mastered: stageMastered };
          })
        : [];

    let otherTracksDue = 0;
    for (const [id, e] of store.srs.entries()) {
      if (deckIds.has(id)) continue;
      if (doneSetAll.has(id)) continue;
      if (isDueNow(e.fsrs, now)) otherTracksDue++;
    }

    setTodayStats({
      deckSize: deck.length,
      dueCount,
      newCount,
      todayDone: goal.done,
      todayTarget: goal.target,
      planCount: planIds.length,
      planMinutes,
      todayCardsAll: doneSetAll.size,
      todayMinutes: minutesFromMs(activity.ms),
      dueTomorrow: dueByTomorrowCount(deckIds, store.srs, now),
      streak,
      laterToday: laterTodayCount(deck, store.srs, now, undefined, reviewedTodayInDeck),
      otherTracksDue,
      feedbackCount: buildFeedbackExport(cardsRef.current, store.fb).length,
      masteredCount: mastered,
      newPerDay: effectiveNewPerDay,
      rawNewPerDay: plan.raw,
      daysLeft: plan.daysLeft,
      correctFuzzyFloor,
      finalStretch,
      // pacing warnings are about the daily plan; a focused module ignores it
      plannerWarning: focusedModule
        ? null
        : finalStretch
          ? '冲刺收尾：暂停新卡，集中刷未掌握的弱卡'
          : plan.warning,
      focusedModule,
      roadmapStages,
      categories: [
        {
          id: ALL_CATEGORY,
          name: '全部',
          total: trackDeck.length,
          mastered: trackMastered,
          seen: trackSeen,
        },
        ...categoryStats,
      ],
    });
    if (validCategory !== s.activeCategory) {
      settingsRef.current = { ...s, activeCategory: validCategory };
      setSettings(settingsRef.current);
    }
  }, [activeTrackDeck]);

  const runSync = useCallback(async () => {
    const db = dbRef.current;
    if (!db) return;
    setSyncState('syncing');
    setSyncMessage('正在合并本机和云端的刷题记录…');
    try {
      const snapshot = await syncNow(db);
      if (!snapshot) {
        setSyncState('error');
        setSyncMessage(
          syncConfigured()
            ? '同步没有开始：请重新点一次按钮并输入同步口令。'
            : '这个版本还没有配置同步服务。',
        );
        return;
      }
      const [srs, fb, samples] = await Promise.all([loadSrs(db), loadFeedback(db), loadElapsedSamples(db)]);
      storeRef.current = { srs, fb };
      typicalRef.current = typicalTimesByType(samples, (id) => cardsByIdRef.current.get(id)?.atomType);
      await refresh();
      setSyncState('success');
      setSyncMessage(syncSummary(snapshot));
    } catch (error) {
      setSyncState('error');
      setSyncMessage(`同步没有完成：${error instanceof Error ? error.message : '请检查网络后重试。'}`);
    }
  }, [refresh]);

  useEffect(() => {
    (async () => {
      try {
        const db = await openDb();
        await seedTracksOnce(db, seedTracks);
        // Pull and merge before loading the queue, so a phone and laptop see the
        // same FSRS state as soon as the app opens.
        try {
          const snapshot = await syncNow(db);
          if (snapshot) {
            setSyncState('success');
            setSyncMessage(syncSummary(snapshot));
          }
        } catch (error) {
          setSyncState('error');
          setSyncMessage(`启动同步没有完成：${error instanceof Error ? error.message : '请稍后在设置页重试。'}`);
        }
        const cards = bundledCards;
        const srs = await loadSrs(db);
        const fb = await loadFeedback(db);
        const kv = await loadSettingsKv(db);
        const loadedSettings = settingsFromKv(kv);
        const dbTracks = await loadTracks(db);

        dbRef.current = db;
        cardsRef.current = cards;
        cardsByIdRef.current = new Map(cards.map((c) => [c.id, c]));
        try {
          const samples = await loadElapsedSamples(db);
          typicalRef.current = typicalTimesByType(samples, (id) => cardsByIdRef.current.get(id)?.atomType);
        } catch (e) {
          console.warn('typical times failed, using 15s fallback', e);
        }
        preloadSfx();
        storeRef.current = { srs, fb };
        tracksRef.current = dbTracks;
        // An interrupted old build can still carry the retired top-level route
        // id. Preserve its place by moving it into the classic-SD roadmap.
        const legacyRoadmapStage = legacyTrackToRoadmapStage(loadedSettings.activeTrackId);
        if (legacyRoadmapStage) {
          loadedSettings.activeTrackId = CLASSIC_SYSTEM_DESIGN_TRACK_ID;
          loadedSettings.activeRoadmapStage = legacyRoadmapStage;
        }
        loadedSettings.activeRoadmapStage = normalizeSystemDesignRoadmapStage(loadedSettings.activeRoadmapStage);
        // deleted-track fallback (review §2 edge): unknown id → 全部
        if (!(loadedSettings.activeTrackId === 'all' || dbTracks.some((t) => t.id === loadedSettings.activeTrackId))) {
          loadedSettings.activeTrackId = 'all';
        }
        settingsRef.current = loadedSettings;
        setSettings(loadedSettings);
        setTracks(dbTracks);
        setRequestRetention(RHYTHMS[loadedSettings.rhythm].requestRetention);
        rescheduleReminders(loadedSettings).catch(() => {});

        await refresh();
        setScreen('today');
      } catch (e) {
        setErrMsg(e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e));
        setScreen('error');
      }
    })();
  }, [refresh]);

  const persistSettings = async (next: AppSettings) => {
    settingsRef.current = next;
    setSettings(next);
    const db = dbRef.current;
    if (db) await saveSettingsKv(db, settingsToKv(next)).catch(() => {});
    setRequestRetention(RHYTHMS[next.rhythm].requestRetention);
    rescheduleReminders(next).catch(() => {});
    await refresh();
  };

  const selectTrack = (id: string) => {
    void persistSettings({
      ...settingsRef.current,
      activeTrackId: id,
      activeRoadmapStage:
        id === CLASSIC_SYSTEM_DESIGN_TRACK_ID
          ? normalizeSystemDesignRoadmapStage(settingsRef.current.activeRoadmapStage)
          : settingsRef.current.activeRoadmapStage,
      activeCategory: ALL_CATEGORY,
    });
  };

  const selectRoadmapStage = (id: string) => {
    void persistSettings({
      ...settingsRef.current,
      activeTrackId: CLASSIC_SYSTEM_DESIGN_TRACK_ID,
      activeRoadmapStage: normalizeSystemDesignRoadmapStage(id),
      activeCategory: ALL_CATEGORY,
    });
  };

  const selectCategory = (id: string) => {
    void persistSettings({ ...settingsRef.current, activeCategory: id });
  };

  const startSession = (mode: SessionMode = 'all') => {
    const store = storeRef.current;
    const stats = todayStats;
    if (!store || !stats) return;
    const now = new Date();
    const deck = activeDeck();
    const reviewedToday = todayDoneIdsRef.current;
    let q = stats.finalStretch
      ? buildWeakSweepQueue(deck, store.srs, { reviewedToday })
      : buildQueue(deck, store.srs, now, {
          newPerDay: stats.newPerDay,
          reviewedToday,
        });
    if (mode === 'review') q = q.filter((id) => store.srs.has(id));
    if (mode === 'new') q = q.filter((id) => !store.srs.has(id));
    // dues keep oldest-first order; only the new-card tail is shuffled per session
    q = orderSessionQueue(q, store.srs);
    if (!q.length) return;
    // A5：一组最多 PLAN_CHUNK 张（到期的照旧最早先做，新卡在后）
    const chunk = planChunk(q);
    const chunked = chunk.length < q.length;
    setSessionDeck(deck);
    setSessionQueue(chunk);
    setSessionReviewedToday(new Set(reviewedToday));
    // mode-filtered sessions bound the mid-session requeue sweep to their own cards;
    // a chunked group too — otherwise the sweep would pull the whole backlog straight back in
    setSessionScope(mode === 'all' && !chunked ? null : new Set(chunk));
    setSessionKey((k) => k + 1);
    setScreen('session');
  };

  const exportFeedback = async () => {
    const store = storeRef.current;
    if (!store) return;
    const items = buildFeedbackExport(cardsRef.current, store.fb);
    if (!items.length) {
      Alert.alert('还没有可导出的反馈', '刷题时点「不确定」、打旗标或写备注，都会进入反馈导出。');
      return;
    }
    const message = JSON.stringify(items, null, 2);

    if (Platform.OS === 'web') {
      const date = localDateStr(new Date());
      if (downloadTextFile(`atoms-feedback-${date}.json`, message)) {
        Alert.alert('反馈已下载', `已导出 ${items.length} 条反馈。`);
      }
      return;
    }

    try {
      await Share.share({ message });
    } catch {
      Alert.alert('导出没有完成', '分享面板被取消了，可以再点一次导出。');
    }
  };

  // one pass over the deck instead of a filterDeck scan per track, memoized so
  // Settings renders don't recompute 6k×N tag matches per keystroke
  const trackCounts = useMemo(() => {
    const all = [ALL_TRACK, ...tracks];
    const counts: Record<string, number> = {};
    for (const t of all) counts[t.id] = 0;
    for (const card of cardsRef.current) {
      for (const t of all) if (cardMatchesTrack(card, t)) counts[t.id]++;
    }
    return counts;
  }, [tracks]);

  return (
    <SafeAreaView
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        // RN's built-in SafeAreaView only insets on iOS; on Android (esp. with a
        // camera cutout + edge-to-edge) the status-bar height must be added so top
        // headers/buttons don't sit under the status bar / camera and become untappable.
        paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight ?? 0 : 0,
      }}
    >
      <StatusBar style="auto" />
      {screen === 'loading' ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={{ color: colors.muted }}>Atoms</Text>
        </View>
      ) : null}

      {screen === 'error' ? (
        <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
          <Text style={{ color: colors.bad, fontSize: 16, fontWeight: '600', marginBottom: 8 }}>
            初始化失败
          </Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>{errMsg}</Text>
        </View>
      ) : null}

      {screen === 'today' && todayStats ? (
        <TodayScreen
          stats={todayStats}
          tracks={pickerTracks()}
          activeTrackId={settings.activeTrackId}
          activeRoadmapStage={settings.activeRoadmapStage}
          activeCategory={settings.activeCategory}
          onSelectTrack={selectTrack}
          onSelectRoadmapStage={selectRoadmapStage}
          onSelectCategory={selectCategory}
          onStart={() => startSession('all')}
          onStartReviews={() => startSession('review')}
          onStartNew={() => startSession('new')}
          onExport={exportFeedback}
          onRefresh={() => void refresh()}
          onSettings={() => setScreen('settings')}
          onRecite={() => setScreen('recite')}
        />
      ) : null}

      {screen === 'recite' ? (
        <ReciteLibraryScreen
          items={reciteItems}
          threads={reciteThreads}
          onOpen={(id) => {
            setReciteThreadId(id);
            setScreen('recite-item');
          }}
          onBack={() => setScreen('today')}
        />
      ) : null}

      {screen === 'recite-item' && reciteThreadId ? (
        <ReciteItemScreen
          items={reciteItems}
          threads={reciteThreads}
          threadId={reciteThreadId}
          onOpen={(id) => setReciteThreadId(id)}
          onBack={() => setScreen('recite')}
        />
      ) : null}

      {screen === 'settings' ? (
        <SettingsScreen
          settings={settings}
          tracks={tracks}
          trackCounts={trackCounts}
          typicalTimes={typicalRef.current}
          onSave={(s) => {
            void persistSettings(s).then(() => setScreen('today'));
          }}
          onAddTrack={(t) => {
            const db = dbRef.current;
            if (!db) return;
            void saveTrack(db, t)
              .then(() => {
                tracksRef.current = [...tracksRef.current, t];
                setTracks(tracksRef.current);
              })
              .catch(() => {});
          }}
          onDeleteTrack={(id) => {
            const db = dbRef.current;
            if (!db) return;
            void deleteTrack(db, id)
              .then(() => {
                tracksRef.current = tracksRef.current.filter((t) => t.id !== id);
                setTracks(tracksRef.current);
                if (settingsRef.current.activeTrackId === id) {
                  void persistSettings({ ...settingsRef.current, activeTrackId: 'all' });
                }
              })
              .catch(() => {});
          }}
          onSyncNow={() => void runSync()}
          syncState={syncState}
          syncMessage={syncMessage}
          onBack={() => {
            void refresh();
            setScreen('today');
          }}
        />
      ) : null}

      {screen === 'session' && dbRef.current && storeRef.current ? (
        <SessionScreen
          key={sessionKey}
          db={dbRef.current}
          cards={sessionDeck}
          store={storeRef.current}
          initialQueue={sessionQueue}
          requeueScope={sessionScope}
          reviewedToday={sessionReviewedToday}
          correctFuzzyFloor={todayStats?.correctFuzzyFloor ?? 4}
          typicalTimes={typicalRef.current}
          soundEnabled={settings.soundEnabled}
          onExit={() => {
            void refresh();
            setScreen('today');
          }}
          onDone={(stats) => {
            setLastStats(stats);
            void refresh().then(() => setScreen('done'));
          }}
        />
      ) : null}

      {screen === 'done' && todayStats ? (
        <DoneScreen
          stats={lastStats}
          todayMinutes={todayStats.todayMinutes}
          dueTomorrow={todayStats.dueTomorrow}
          streak={todayStats.streak}
          soundEnabled={settings.soundEnabled}
          onBack={() => {
            void refresh();
            setScreen('today');
          }}
          onExport={exportFeedback}
        />
      ) : null}
    </SafeAreaView>
  );
}
