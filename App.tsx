import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, SafeAreaView, Share, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import bundledCardsJson from './src/content/deck.bundle.json';
import seedTracksJson from './src/content/tracks.json';
import {
  deleteTrack,
  distinctCardsOnDay,
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
} from './src/db/database';
import { MASTERED_STABILITY_DAYS, RHYTHMS } from './src/config';
import { localDateStr } from './src/logic/dates';
import { buildFeedbackExport } from './src/logic/feedback';
import { ALL_CATEGORY, buildCategoryStats, filterByCategory } from './src/logic/categories';
import { buildQueue, introducedTodayCount, isDueNow, laterTodayCount, orderSessionQueue } from './src/logic/queue';
import { planNewPerDay } from './src/logic/planner';
import { DEFAULT_SETTINGS, settingsFromKv, settingsToKv } from './src/logic/settings';
import { setRequestRetention, State } from './src/logic/srs';
import { computeStreak, dailyGoal } from './src/logic/streak';
import { ALL_TRACK, cardMatchesTrack, filterDeck, findTrack } from './src/logic/tracks';
import { rescheduleReminders } from './src/notifications';
import { useTheme } from './src/theme';
import type { AppSettings, Card, Track } from './src/types';
import { DoneScreen } from './src/screens/DoneScreen';
import { SessionScreen, type SessionStats, type SessionStore } from './src/screens/SessionScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { TodayScreen, type TodayStats } from './src/screens/TodayScreen';

const bundledCards = bundledCardsJson as unknown as Card[];
const seedTracks = seedTracksJson as unknown as Track[];

type Screen = 'loading' | 'error' | 'today' | 'session' | 'done' | 'settings';
type SessionMode = 'all' | 'review' | 'new';

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
  const [sessionKey, setSessionKey] = useState(0);
  const [lastStats, setLastStats] = useState<SessionStats>({ answered: 0, correct: 0 });

  const dbRef = useRef<Db | null>(null);
  const cardsRef = useRef<Card[]>([]);
  const storeRef = useRef<SessionStore | null>(null);
  const settingsRef = useRef<AppSettings>(DEFAULT_SETTINGS);
  const tracksRef = useRef<Track[]>([]);

  const pickerTracks = useCallback((): Track[] => [ALL_TRACK, ...tracksRef.current], []);

  const activeDeck = useCallback((): Card[] => {
    const track = findTrack(pickerTracks(), settingsRef.current.activeTrackId);
    const trackDeck = filterDeck(cardsRef.current, track);
    return filterByCategory(trackDeck, settingsRef.current.activeCategory);
  }, [pickerTracks]);

  const activeTrackDeck = useCallback((): Card[] => {
    const track = findTrack(pickerTracks(), settingsRef.current.activeTrackId);
    return filterDeck(cardsRef.current, track);
  }, [pickerTracks]);

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

    let mastered = 0;
    let trackMastered = 0;
    for (const [id, e] of store.srs.entries()) {
      const isMastered = e.fsrs.state === State.Review && e.fsrs.stability >= MASTERED_STABILITY_DAYS;
      if (trackDeckIds.has(id) && isMastered) trackMastered++;
      if (deckIds.has(id) && isMastered) mastered++;
    }

    const plan = planNewPerDay({ targetDate: s.targetDate, deckSize: deck.length, mastered, now });
    // A focused module (specific category) is a small finite set — the user
    // wants to finish it in one go, so the daily new-card quota only applies
    // to the "全部" view where the planner paces the whole track.
    const focusedModule = validCategory !== ALL_CATEGORY;
    const effectiveNewPerDay = focusedModule ? deck.length : plan.newPerDay;
    const queue = buildQueue(deck, store.srs, now, { newPerDay: effectiveNewPerDay });
    const dueCount = queue.filter((id) => store.srs.has(id)).length;
    const newCount = queue.length - dueCount;

    const doneSetAll = await distinctCardsOnDay(db, localDateStr(now));
    let doneInDeck = 0;
    for (const id of doneSetAll) if (deckIds.has(id)) doneInDeck++;
    const quotaLeft = Math.max(0, effectiveNewPerDay - introducedTodayCount(store.srs, now, deckIds));
    const goal = dailyGoal(doneInDeck, dueCount, Math.min(quotaLeft, newCount));

    const streak = computeStreak(await studiedDays(db), now);

    let otherTracksDue = 0;
    for (const [id, e] of store.srs.entries()) {
      if (deckIds.has(id)) continue;
      if (isDueNow(e.fsrs, now)) otherTracksDue++;
    }

    setTodayStats({
      deckSize: deck.length,
      dueCount,
      newCount,
      todayDone: goal.done,
      todayTarget: goal.target,
      streak,
      laterToday: laterTodayCount(deck, store.srs, now),
      otherTracksDue,
      feedbackCount: buildFeedbackExport(cardsRef.current, store.fb).length,
      masteredCount: mastered,
      newPerDay: effectiveNewPerDay,
      rawNewPerDay: plan.raw,
      daysLeft: plan.daysLeft,
      // pacing warnings are about the daily plan; a focused module ignores it
      plannerWarning: focusedModule ? null : plan.warning,
      focusedModule,
      categories: [
        {
          id: ALL_CATEGORY,
          name: '全部',
          total: trackDeck.length,
          mastered: trackMastered,
        },
        ...categoryStats,
      ],
    });
    if (validCategory !== s.activeCategory) {
      settingsRef.current = { ...s, activeCategory: validCategory };
      setSettings(settingsRef.current);
    }
  }, [activeTrackDeck]);

  useEffect(() => {
    (async () => {
      try {
        const db = await openDb();
        await seedTracksOnce(db, seedTracks);
        const cards = bundledCards;
        const srs = await loadSrs(db);
        const fb = await loadFeedback(db);
        const kv = await loadSettingsKv(db);
        const loadedSettings = settingsFromKv(kv);
        const dbTracks = await loadTracks(db);

        dbRef.current = db;
        cardsRef.current = cards;
        storeRef.current = { srs, fb };
        tracksRef.current = dbTracks;
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
    void persistSettings({ ...settingsRef.current, activeTrackId: id, activeCategory: ALL_CATEGORY });
  };

  const selectCategory = (id: string) => {
    void persistSettings({ ...settingsRef.current, activeCategory: id });
  };

  const startSession = (mode: SessionMode = 'all') => {
    const store = storeRef.current;
    const stats = todayStats;
    if (!store || !stats) return;
    const deck = activeDeck();
    let q = buildQueue(deck, store.srs, new Date(), { newPerDay: stats.newPerDay });
    if (mode === 'review') q = q.filter((id) => store.srs.has(id));
    if (mode === 'new') q = q.filter((id) => !store.srs.has(id));
    // dues keep oldest-first order; only the new-card tail is shuffled per session
    q = orderSessionQueue(q, store.srs);
    if (!q.length) return;
    setSessionDeck(deck);
    setSessionQueue(q);
    // mode-filtered sessions bound the mid-session requeue sweep to their own cards
    setSessionScope(mode === 'all' ? null : new Set(q));
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
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
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
          activeCategory={settings.activeCategory}
          onSelectTrack={selectTrack}
          onSelectCategory={selectCategory}
          onStart={() => startSession('all')}
          onStartReviews={() => startSession('review')}
          onStartNew={() => startSession('new')}
          onExport={exportFeedback}
          onRefresh={() => void refresh()}
          onSettings={() => setScreen('settings')}
        />
      ) : null}

      {screen === 'settings' ? (
        <SettingsScreen
          settings={settings}
          tracks={tracks}
          trackCounts={trackCounts}
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
          todayDone={todayStats.todayDone}
          todayTarget={todayStats.todayTarget}
          streak={todayStats.streak}
          laterToday={todayStats.laterToday}
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
