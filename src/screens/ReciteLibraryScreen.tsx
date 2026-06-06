import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTheme, type Palette } from '../theme';
import { AudioTrack } from '../components/AudioTrack';
import { SelectPicker } from '../components/SelectPicker';
import { getOverview, origUrl, reciteConfigured } from '../recite/api';
import {
  aggregateRowState,
  buildSections,
  companyOptions,
  countSections,
  dupeIds,
  filterSections,
  isFiltering,
  kindOptions,
  libraryCounts,
  queueChipLabel,
  rowTags,
  toRow,
  type LibraryFilter,
  type LibraryRow,
  type RowTag,
  type TagTone,
} from '../recite/library';
import { threadOfItem, type ResolvedThread } from '../recite/threads';
import {
  libraryCache,
  seedOpenCompany,
  setLibraryFilter,
  setLibraryGroups,
  setLibraryOverview,
  setLibraryScrollY,
} from '../recite/libraryCache';
import { recBarHidden, setRecBarHidden } from '../recite/prefs';
import type { ReciteItem, ReciteOverview, ReciteState } from '../recite/types';

/**
 * 🎤 念稿库 —— jobscan templates/recite.html 的 RN 版。
 *
 * M4 §0 决定 1：**库优先**。入口页就是总库，搜索 + 过滤 + 行内试听原声；
 * 「今日推荐」只是一条可关的横条，绝不占视线中心，也绝不挡住库。
 *
 * 2026-09-03 她定的顺序（M4 §4）：① 🎧 有面试原声 ② 📘 BQ playbook ③ 其他（默认折叠）。
 * 段头比公司头重一档 —— 这三段是她挑东西的第一层决策，公司只是第二层。
 *
 * 内容全在 bundle 里，所以服务不可达时这一页照样打得开 —— 只是不能录、不能评。
 * 搜索/过滤条不在 ScrollView 里，是上面固定的一块：336 行滚下去以后，搜索框不能跟着滚没。
 * 搜索/展开/滚动位置和 overview 都存在 libraryCache 里，练完一条回来是原样。
 */

export interface ReciteLibraryScreenProps {
  items: ReciteItem[];
  /** 库的单位是 thread（主问题 + 追问链），不是单个条目 */
  threads: ResolvedThread[];
  /** 参数是 thread_id */
  onOpen: (threadId: string) => void;
  onBack: () => void;
}

/** 打字到过滤之间的等待。太短 = 每敲一个字重排 336 行；太长 = 手感发黏。 */
const QUERY_DEBOUNCE_MS = 120;

function tagStyle(tone: TagTone, colors: Palette): { bg: string; fg: string } {
  switch (tone) {
    case 'good':
      return { bg: colors.tealBg, fg: colors.tealInk };
    case 'warn':
      return { bg: colors.amberBg, fg: colors.amberInk };
    case 'note':
      return { bg: colors.accentSoft, fg: colors.accent };
    default:
      return { bg: colors.chip, fg: colors.muted };
  }
}

function Tag({ tag }: { tag: RowTag }) {
  const { colors } = useTheme();
  const s = tagStyle(tag.tone, colors);
  return (
    <Text
      style={{
        fontSize: 11,
        lineHeight: 18,
        paddingHorizontal: 6,
        borderRadius: 20,
        overflow: 'hidden',
        backgroundColor: s.bg,
        color: s.fg,
      }}
    >
      {tag.text}
    </Text>
  );
}

function ItemRow({
  row,
  tags,
  playing,
  onTogglePlay,
  onOpen,
}: {
  row: LibraryRow;
  tags: RowTag[];
  playing: boolean;
  onTogglePlay: () => void;
  onOpen: () => void;
}) {
  const { colors } = useTheme();
  // ▶ 播主问题那一段的原声；整条链的其余段在练习页里各有各的 ▶。
  const main = row.thread.main.item;
  const src = origUrl(main.id);
  const canPlay = main.has_orig && Boolean(src);
  return (
    <View style={[styles.row, { borderTopColor: colors.line }]}>
      <Pressable
        disabled={!canPlay}
        onPress={onTogglePlay}
        style={[
          styles.playBtn,
          {
            borderColor: playing ? colors.accent : colors.line,
            backgroundColor: playing ? colors.accent : colors.card,
            opacity: canPlay ? 1 : 0.25,
          },
        ]}
      >
        <Text style={{ fontSize: 13, color: playing ? '#fff' : colors.ink }}>⏯</Text>
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 14, color: colors.ink }}>{row.title}</Text>
        {row.subtitle && row.subtitle !== row.title ? (
          <Text style={{ fontSize: 12.5, color: colors.muted, marginTop: 1 }}>{row.subtitle}</Text>
        ) : null}
        <View style={styles.tagRow}>
          {tags.map((t, idx) => (
            <Tag key={`${t.text}-${idx}`} tag={t} />
          ))}
        </View>
        {playing && src ? (
          <View style={{ marginTop: 6 }}>
            <AudioTrack src={src} autoPlay />
          </View>
        ) : null}
      </View>
      <Pressable onPress={onOpen} style={[styles.goBtn, { backgroundColor: colors.accent }]}>
        <Text style={{ fontSize: 13, color: '#fff' }}>练 →</Text>
      </Pressable>
    </View>
  );
}

export function ReciteLibraryScreen({ items, threads, onOpen, onBack }: ReciteLibraryScreenProps) {
  const { colors } = useTheme();
  const cache = libraryCache();

  const rows = useMemo(() => threads.map(toRow), [threads]);
  const sections = useMemo(() => buildSections(rows), [rows]);
  // 第一段的第一家公司默认展开，只种一次。
  const firstCo = sections.find((s) => s.companies.length)?.companies[0];
  const firstSec = sections.find((s) => s.companies.length);
  if (firstCo && firstSec) seedOpenCompany(`${firstSec.id}//${firstCo.name}`);

  const [filter, setFilter] = useState<LibraryFilter>(cache.filter);
  /** 输入框里的原始文字；防抖之后才写进 filter.query */
  const [typed, setTyped] = useState(cache.filter.query);
  const [overview, setOverview] = useState<ReciteOverview | null>(cache.overview);
  const [serverNote, setServerNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [barHidden, setBarHidden] = useState(recBarHidden);
  const [closedSections, setClosedSections] = useState<Set<string>>(cache.closedSections);
  const [openCo, setOpenCo] = useState<Set<string>>(cache.openCo);
  const [closedSes, setClosedSes] = useState<Set<string>>(cache.closedSes);

  const scrollRef = useRef<ScrollView>(null);
  const restored = useRef(false);

  // 每一次改动都同步回缓存 —— 练完一条回来要落在同一个位置。
  useEffect(() => setLibraryFilter(filter), [filter]);
  useEffect(
    () => setLibraryGroups(openCo, closedSes, closedSections),
    [openCo, closedSes, closedSections],
  );

  useEffect(() => {
    if (typed === filter.query) return;
    const t = setTimeout(() => setFilter((f) => ({ ...f, query: typed })), QUERY_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [typed, filter.query]);

  const visible = useMemo(() => filterSections(sections, filter), [sections, filter]);
  // 展开/收起两个按钮共用的全量键，键的形状必须和渲染时一模一样。
  const allCoKeys = useMemo(
    () => sections.flatMap((sec) => sec.companies.map((c) => `${sec.id}//${c.name}`)),
    [sections],
  );
  const allSesKeys = useMemo(
    () =>
      sections.flatMap((sec) =>
        sec.companies.flatMap((c) => c.sessions.map((ses) => `${sec.id}//${c.name}//${ses.name}`)),
      ),
    [sections],
  );
  const filtering = isFiltering(filter);
  const companies = useMemo(() => companyOptions(items), [items]);
  const kinds = useMemo(() => kindOptions(items), [items]);
  const bundleDupes = useMemo(() => dupeIds(items), [items]);

  const state = useMemo(() => overview?.state ?? {}, [overview]);
  const nTakes = overview?.n_takes ?? {};
  const counts = useMemo(() => libraryCounts(items, state, threads.length), [items, state, threads.length]);
  const queueIds = useMemo(() => new Set(overview?.queue_ids ?? []), [overview]);
  const dupes = useMemo(
    () => (overview?.dupes?.length ? new Set(overview.dupes) : bundleDupes),
    [overview, bundleDupes],
  );

  const loadOverview = useCallback(async () => {
    if (!reciteConfigured()) {
      setServerNote('服务不可达：只能看，不能录（没配 EXPO_PUBLIC_ATOM_RECITE_URL 或没有口令）');
      return;
    }
    setLoading(true);
    try {
      const o = await getOverview();
      setOverview(o);
      setLibraryOverview(o);
      setServerNote(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setServerNote(`服务不可达：只能看，不能录 —— ${msg}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // 缓存里有新鲜的 overview 就直接用 —— 「库 → 练 → 回库」一轮十几次，不该每次都打一遍网络。
  useEffect(() => {
    if (cache.overview && !cache.stale) {
      setOverview(cache.overview);
      if (!reciteConfigured()) {
        setServerNote('服务不可达：只能看，不能录（没配 EXPO_PUBLIC_ATOM_RECITE_URL 或没有口令）');
      }
      return;
    }
    void loadOverview();
  }, [cache, loadOverview]);

  // 有命中就自动展开，和 recite.js 的 apply() 一样：搜出来的东西不能藏在折叠里。
  const secOpen = useCallback(
    (id: string) => filtering || !closedSections.has(id),
    [filtering, closedSections],
  );
  const coOpen = useCallback((key: string) => filtering || openCo.has(key), [filtering, openCo]);
  const sesOpen = useCallback((key: string) => filtering || !closedSes.has(key), [filtering, closedSes]);

  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  // 队列给的是 item_id；胶囊点开的必须是它所在的那条链，而且同一条链只出现一次。
  const queueThreads: Array<{ thread: ResolvedThread; item: ReciteItem }> = [];
  {
    const seen = new Set<string>();
    for (const id of overview?.queue_ids ?? []) {
      const th = threadOfItem(threads, id);
      if (!th || seen.has(th.thread.thread_id)) continue;
      seen.add(th.thread.thread_id);
      const item = th.items.find((i) => i.id === id) ?? th.main.item;
      queueThreads.push({ thread: th, item });
    }
  }

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setLibraryScrollY(e.nativeEvent.contentOffset.y);
  };

  // 内容量出来之后才能滚回去；只做一次，之后是她自己在滚。
  const onContentSizeChange = (_w: number, h: number) => {
    if (restored.current) return;
    const y = cache.scrollY;
    if (y <= 0) {
      restored.current = true;
      return;
    }
    if (h > y) {
      restored.current = true;
      scrollRef.current?.scrollTo({ y, animated: false });
    }
  };

  const renderRow = (row: LibraryRow) => {
    const id = row.thread.thread.thread_id;
    const agg = aggregateRowState(row, state, nTakes);
    return (
      <ItemRow
        key={id}
        row={row}
        playing={playing === id}
        onTogglePlay={() => setPlaying(playing === id ? null : id)}
        onOpen={() => onOpen(id)}
        tags={rowTags(row, { queueIds, dupes, ...agg })}
      />
    );
  };

  return (
    <View style={{ flex: 1 }}>
      {/* ── 固定头：滚多远都还在 ─────────────────────────────────────────── */}
      <View style={[styles.stickyHeader, { backgroundColor: colors.bg, borderBottomColor: colors.line }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable onPress={onBack} hitSlop={10}>
            <Text style={{ fontSize: 13, color: colors.accent }}>← 今日</Text>
          </Pressable>
          <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>🎤 念稿库</Text>
          <Pressable
            onPress={() => void loadOverview()}
            disabled={loading}
            hitSlop={10}
            style={{ marginLeft: 'auto' }}
          >
            <Text style={{ fontSize: 13, color: colors.accent, opacity: loading ? 0.4 : 1 }}>
              {loading ? '刷新中…' : '⟳ 刷新'}
            </Text>
          </Pressable>
        </View>

        <TextInput
          value={typed}
          onChangeText={setTyped}
          placeholder={`搜问题 / 追问 / 场次 / item id…（${counts.threads} 条题全在下面）`}
          placeholderTextColor={colors.muted}
          autoCorrect={false}
          style={[
            styles.control,
            { borderColor: colors.line, backgroundColor: colors.card, color: colors.ink, marginTop: 8 },
          ]}
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          <SelectPicker
            label="公司"
            allLabel="全部公司"
            value={filter.company}
            options={companies}
            onChange={(company) => setFilter((f) => ({ ...f, company }))}
          />
          <SelectPicker
            label="类型"
            allLabel="全部类型"
            value={filter.kind}
            options={kinds}
            onChange={(kind) => setFilter((f) => ({ ...f, kind }))}
          />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8 }}>
          {/* 「只看有原声」的勾选框拿掉了 —— 第一段「🎧 有面试原声」本身就是这个筛子。 */}
          <Pressable
            onPress={() => {
              setClosedSections(new Set());
              setOpenCo(new Set(allCoKeys));
              setClosedSes(new Set());
            }}
            style={[styles.control, { borderColor: colors.line, backgroundColor: colors.card }]}
          >
            <Text style={{ fontSize: 13, color: colors.ink }}>全部展开</Text>
          </Pressable>
          <Pressable
            // 「全部收起」是「全部展开」的逆操作：段回到默认（只有「其他」折着）、
            // 公司全关、场次全关。不然点完收起再点展开，状态跟第一次进来时不一样。
            onPress={() => {
              setClosedSections(new Set(['other']));
              setOpenCo(new Set());
              setClosedSes(new Set(allSesKeys));
            }}
            style={[styles.control, { borderColor: colors.line, backgroundColor: colors.card }]}
          >
            <Text style={{ fontSize: 13, color: colors.ink }}>全部收起</Text>
          </Pressable>
          {filtering ? (
            <Text style={{ fontSize: 12.5, color: colors.muted }}>命中 {countSections(visible)} 条</Text>
          ) : null}
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 60 }}
        onScroll={onScroll}
        scrollEventThrottle={64}
        onContentSizeChange={onContentSizeChange}
      >
        <Text style={{ fontSize: 13, color: colors.muted, marginTop: 10 }}>
          全库 {counts.threads} 条题 · {counts.companies} 家公司 · 🎧 原声 {counts.orig} 段 · 你说了{' '}
          {overview?.hist?.spoken_min ?? 0} 分钟（近 40 次） · ✅ 三遍全勾 {counts.practiced}/
          {counts.practiceDen} 段
        </Text>

        {serverNote ? (
          <View style={[styles.notice, { backgroundColor: colors.amberBg }]}>
            <Text style={{ fontSize: 12.5, color: colors.amberInk }}>{serverNote}</Text>
          </View>
        ) : null}

        {!barHidden && queueThreads.length ? (
          <View style={[styles.recBar, { backgroundColor: colors.tealBg }]}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.tealInk }}>
              今日推荐 {queueThreads.length} 条
            </Text>
            {queueThreads.slice(0, 8).map(({ thread, item }) => (
              <Pressable
                key={thread.thread.thread_id}
                onPress={() => onOpen(thread.thread.thread_id)}
                style={[styles.recChip, { borderColor: colors.line, backgroundColor: colors.card }]}
              >
                <Text style={{ fontSize: 12.5, color: colors.tealInk }}>{queueChipLabel(item)}</Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => {
                setBarHidden(true);
                setRecBarHidden(true);
              }}
              hitSlop={10}
              style={{ marginLeft: 'auto' }}
            >
              <Text style={{ fontSize: 15, color: colors.tealInk }}>×</Text>
            </Pressable>
          </View>
        ) : null}

        {/* 段 → 公司 →（场次）→ 行 */}
        {visible.map((sec) => {
          const open = secOpen(sec.id);
          return (
            <View key={sec.id} style={{ marginTop: 18 }}>
              <Pressable
                onPress={() => setClosedSections((s) => toggle(s, sec.id))}
                style={[styles.sectionHead, { borderBottomColor: colors.accent }]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                  <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>
                    {open ? '▾' : '▸'} {sec.title}
                  </Text>
                  <Text style={{ fontSize: 13, color: colors.muted, marginLeft: 'auto' }}>
                    {sec.n} 条 · {sec.companies.length} 家
                  </Text>
                </View>
                {sec.subtitle ? (
                  <Text style={{ fontSize: 12.5, color: colors.muted, marginTop: 3 }}>{sec.subtitle}</Text>
                ) : null}
              </Pressable>

              {open
                ? sec.companies.map((co) => {
                    const coKey = `${sec.id}//${co.name}`;
                    const coIsOpen = coOpen(coKey);
                    return (
                      <View
                        key={coKey}
                        style={[styles.group, { borderColor: colors.line, backgroundColor: colors.card }]}
                      >
                        <Pressable
                          onPress={() => setOpenCo((s) => toggle(s, coKey))}
                          style={styles.groupHead}
                        >
                          <Text style={{ fontSize: 15, fontWeight: '600', color: colors.ink }}>
                            {coIsOpen ? '▾' : '▸'} {co.name}
                          </Text>
                          <Text style={{ fontSize: 12.5, color: colors.muted }}>
                            {co.n} 条{co.flat ? '' : ` · ${co.sessions.length} 场`}
                          </Text>
                        </Pressable>

                        {coIsOpen && co.flat
                          ? co.sessions[0]?.rows.map(renderRow)
                          : coIsOpen
                            ? co.sessions.map((s) => {
                                const sesKey = `${coKey}//${s.name}`;
                                const sOpen = sesOpen(sesKey);
                                return (
                                  <View key={sesKey} style={{ borderTopWidth: 1, borderTopColor: colors.line }}>
                                    <Pressable
                                      onPress={() => setClosedSes((x) => toggle(x, sesKey))}
                                      style={{
                                        paddingVertical: 8,
                                        paddingHorizontal: 14,
                                        backgroundColor: colors.bg,
                                      }}
                                    >
                                      <Text style={{ fontSize: 13, color: colors.ink }}>
                                        {sOpen ? '▾' : '▸'} {s.name} · {s.rows.length} 条
                                      </Text>
                                    </Pressable>
                                    {sOpen ? s.rows.map(renderRow) : null}
                                  </View>
                                );
                              })
                            : null}
                      </View>
                    );
                  })
                : null}
            </View>
          );
        })}

        {!visible.length ? (
          <Text style={{ fontSize: 13, color: colors.muted, marginTop: 20 }}>
            没有命中的条目 —— 换个词，或者把过滤清掉。
          </Text>
        ) : null}

        <View style={[styles.foot, { borderTopColor: colors.line }]}>
          {overview?.hist?.buckets?.length ? (
            <Text style={{ fontSize: 12.5, color: colors.muted }}>
              {overview.hist.buckets.map((b) => `${b.name} ${b.n} 次 · 过关 ${b.pass_rate}%`).join(' ｜ ')}
            </Text>
          ) : null}
          <Text style={{ fontSize: 12.5, color: colors.muted, marginTop: 4 }}>
            ⚠ 稿要改 / 未过筛 {counts.rough} · 已归档 {counts.archived} · 无念稿 {counts.noscript}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  stickyHeader: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  notice: { borderRadius: 9, paddingVertical: 8, paddingHorizontal: 11, marginTop: 10 },
  recBar: {
    borderRadius: 9,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  recChip: { borderWidth: 1, borderRadius: 14, paddingVertical: 2, paddingHorizontal: 9 },
  control: { borderWidth: 1, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 11, fontSize: 14 },
  // 段头比公司头重一档：粗、大、底下一条 accent 色的线。
  sectionHead: { paddingBottom: 7, borderBottomWidth: 2, marginBottom: 2 },
  group: { borderWidth: 1, borderRadius: 10, marginTop: 10, overflow: 'hidden' },
  groupHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingVertical: 11,
    paddingHorizontal: 14,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 9,
    alignItems: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderTopWidth: 1,
  },
  playBtn: { width: 30, height: 30, borderRadius: 99, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 3 },
  goBtn: { alignSelf: 'center', paddingVertical: 5, paddingHorizontal: 12, borderRadius: 7 },
  foot: { marginTop: 24, borderTopWidth: 1, paddingTop: 12 },
});
