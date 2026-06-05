import type { ResolvedThread } from './threads';
import type { ReciteItem, ReciteState, ScriptVersion } from './types';

/**
 * 总库的纯逻辑：分组、搜索/过滤、行标签、撞车检测、页脚计数。
 * 逐条对着 jobscan `_recite_library` / `_recite_groups` / recite.html 的行内脚本，
 * 好处是这一层不碰 React 也不碰网络，selftest 里能直接跑。
 *
 * 2026-09-03 起**一行 = 一条 thread**（主问题 + 追问链），不再是一行一个条目。
 */

export interface LibraryRow {
  thread: ResolvedThread;
  /** 行首那一行：优先英文原题 */
  title: string;
  /** 第二行中文；和 title 相同就不显示 */
  subtitle: string;
  /** 搜索用的小写串：全链的中英题面 + 场次 + item id */
  search: string;
  hasScript: boolean;
  /** 追问段数 */
  followupCount: number;
}

export interface LibrarySession {
  name: string;
  rows: LibraryRow[];
}

export interface LibraryCompany {
  name: string;
  n: number;
  sessions: LibrarySession[];
  /** true = 这一组不按场次分（BQ playbook 只按公司），渲染时跳过场次那一层 */
  flat?: boolean;
}

export type LibrarySectionId = 'orig' | 'playbook' | 'other';

/**
 * 总库的三段（她 2026-09-03 定的顺序，M4 §4）：
 * ① 有面试原声的 —— 唯一有「当时到底怎么答的」可比对的那批，排最高；
 * ② BQ playbook —— 她想练的故事库，按公司平铺（没有场次概念）；
 * ③ 其他 —— 开口微稿和没原声的零头，默认折叠，她基本不看。
 */
export interface LibrarySection {
  id: LibrarySectionId;
  title: string;
  subtitle: string;
  companies: LibraryCompany[];
  n: number;
  /** 默认折起来（只有 ③ 是 true） */
  defaultCollapsed: boolean;
}

export interface LibraryFilter {
  query: string;
  company: string;
  kind: string;
  origOnly: boolean;
}

export const EMPTY_FILTER: LibraryFilter = { query: '', company: '', kind: '', origOnly: false };

export function isFiltering(f: LibraryFilter): boolean {
  return Boolean(f.query.trim() || f.company || f.kind || f.origOnly);
}

const UNGROUPED = '（未分场）';

/** 面试官的应答词被当成题目录进来了：「Okay.」「Okay, sounds good.」这种。 */
const FILLER_Q_RX = /^(okay|ok|yeah|yes|good|great|cool|sure|right)[\s.,!]*$/i;

/**
 * 英文题面是废话时，把中文提到第一行 —— 库里有十几行显示成「Okay.」，
 * 那是切段时把面试官的一声应答当成了问题，她扫一眼根本认不出是哪一条。
 */
export function isFillerQuestion(question: string): boolean {
  const q = (question || '').trim();
  if (!q) return true;
  if (FILLER_Q_RX.test(q)) return true;
  return q.split(/\s+/).filter(Boolean).length < 4;
}

export function toRow(thread: ResolvedThread): LibraryRow {
  const main = thread.main.item;
  // 分组表给的标题优先；没分组时就是主问题本身。
  const en = (thread.grouped ? thread.thread.title : main.question || '').trim();
  const zh = (thread.grouped ? thread.thread.title_zh : main.question_zh || '').trim();
  const filler = isFillerQuestion(en);
  const title = (filler && zh ? zh : en || zh || main.id).trim();
  const subtitle = filler && zh ? en : zh;
  return {
    thread,
    title,
    subtitle,
    // 搜索命中任意一段：她可能记得的是某个追问，不是主问题。
    search: thread.search,
    hasScript: thread.hasScript,
    // 没分组时退回旧口径（同一段对话里挂在这题下面的追问），有分组就是真的追问段数。
    followupCount: thread.grouped ? thread.followupCount : main.dialog_followups.length,
  };
}

/** 公司按条数降序、同数按名字；场次按名字。和 jobscan 的排序一致。 */
export function groupByCompany(rows: LibraryRow[]): LibraryCompany[] {
  const byCo = new Map<string, Map<string, LibraryRow[]>>();
  for (const row of rows) {
    const co = row.thread.co;
    let sessions = byCo.get(co);
    if (!sessions) {
      sessions = new Map();
      byCo.set(co, sessions);
    }
    const name = row.thread.interview;
    const list = sessions.get(name);
    if (list) list.push(row);
    else sessions.set(name, [row]);
  }
  const out: LibraryCompany[] = [];
  for (const [name, sessions] of byCo) {
    const list = [...sessions.entries()]
      .map(([sName, sRows]) => ({ name: sName, rows: sRows }))
      .sort((a, b) => a.name.localeCompare(b.name));
    out.push({ name, n: list.reduce((n, s) => n + s.rows.length, 0), sessions: list });
  }
  out.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  return out;
}

/** 只按公司分（BQ playbook），公司按名字排。 */
export function groupByCompanyFlat(rows: LibraryRow[]): LibraryCompany[] {
  const byCo = new Map<string, LibraryRow[]>();
  for (const row of rows) {
    const co = row.thread.co;
    const list = byCo.get(co);
    if (list) list.push(row);
    else byCo.set(co, [row]);
  }
  return [...byCo.entries()]
    .map(([name, list]) => ({ name, n: list.length, sessions: [{ name: '', rows: list }], flat: true }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** 场次里只要有一条有原声，整场都算「有原声那一段」—— 同一场的题不该被拆到两个区。 */
function sessionsWithOrig(rows: LibraryRow[]): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    if (r.thread.hasOrig) out.add(`${r.thread.co}//${r.thread.interview}`);
  }
  return out;
}

export function buildSections(rows: LibraryRow[]): LibrarySection[] {
  const origSessions = sessionsWithOrig(rows);
  const orig: LibraryRow[] = [];
  const playbook: LibraryRow[] = [];
  const other: LibraryRow[] = [];
  for (const r of rows) {
    const key = `${r.thread.co}//${r.thread.interview}`;
    if (r.thread.hasOrig || origSessions.has(key)) orig.push(r);
    else if (r.thread.main.item.source === 'playbook') playbook.push(r);
    else other.push(r);
  }
  return [
    {
      id: 'orig',
      title: '🎧 有面试原声',
      subtitle: '当时真的怎么答的，就在每一行的 ⏯ 里 —— 只有这一批能和自己对着比',
      companies: groupByCompany(orig),
      n: orig.length,
      defaultCollapsed: false,
    },
    {
      id: 'playbook',
      title: '📘 BQ playbook',
      subtitle: '每条有短版（1–2 分钟）和长版（3–5 分钟），练习页里切',
      companies: groupByCompanyFlat(playbook),
      n: playbook.length,
      defaultCollapsed: false,
    },
    {
      id: 'other',
      title: '其他',
      subtitle: '开口微稿和没有原声的零头',
      companies: groupByCompany(other),
      n: other.length,
      defaultCollapsed: true,
    },
  ];
}

/** 过滤后空掉的段整段消失；命中数是三段加总。 */
export function filterSections(sections: LibrarySection[], f: LibraryFilter): LibrarySection[] {
  if (!isFiltering(f)) return sections;
  const out: LibrarySection[] = [];
  for (const sec of sections) {
    const companies = filterGroups(sec.companies, f);
    const n = countRows(companies);
    if (n) out.push({ ...sec, companies, n });
  }
  return out;
}

export function countSections(sections: LibrarySection[]): number {
  return sections.reduce((n, sec) => n + sec.n, 0);
}

export function matchesFilter(row: LibraryRow, f: LibraryFilter): boolean {
  const q = f.query.trim().toLowerCase();
  if (q && !row.search.includes(q)) return false;
  if (f.company && row.thread.co !== f.company) return false;
  // 类型看整条链：按 bq 筛，主问题是 bq、追问是 technical-deepdive 的那条也该出来。
  if (f.kind && !row.thread.items.some((i) => (i.kind || '') === f.kind)) return false;
  if (f.origOnly && !row.thread.hasOrig) return false;
  return true;
}

/** 过滤后仍为空的场次/公司整块消失（recite.js 的 apply() 就是这么做的）。 */
export function filterGroups(groups: LibraryCompany[], f: LibraryFilter): LibraryCompany[] {
  if (!isFiltering(f)) return groups;
  const out: LibraryCompany[] = [];
  for (const co of groups) {
    const sessions: LibrarySession[] = [];
    for (const s of co.sessions) {
      const rows = s.rows.filter((r) => matchesFilter(r, f));
      if (rows.length) sessions.push({ name: s.name, rows });
    }
    if (sessions.length) {
      out.push({
        name: co.name,
        n: sessions.reduce((n, s) => n + s.rows.length, 0),
        sessions,
        flat: co.flat,
      });
    }
  }
  return out;
}

export function countRows(groups: LibraryCompany[]): number {
  return groups.reduce((n, co) => n + co.n, 0);
}

export function companyOptions(items: ReciteItem[]): string[] {
  return [...new Set(items.map((i) => i.co || '其他'))].sort((a, b) => a.localeCompare(b));
}

export function kindOptions(items: ReciteItem[]): string[] {
  return [...new Set(items.map((i) => i.kind).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/** 同一个 link_group 下有 >1 条 = 撞车（两条会喂同一个项目）。 */
export function dupeIds(items: ReciteItem[]): Set<string> {
  const groups = new Map<string, string[]>();
  for (const it of items) {
    const g = (it.link_group || '').trim();
    if (!g) continue;
    const list = groups.get(g);
    if (list) list.push(it.id);
    else groups.set(g, [it.id]);
  }
  const out = new Set<string>();
  for (const ids of groups.values()) {
    if (ids.length > 1) for (const id of ids) out.add(id);
  }
  return out;
}

export type TagTone = 'plain' | 'good' | 'warn' | 'note';

export interface RowTag {
  text: string;
  tone: TagTone;
}

export interface RowTagContext {
  queueIds: Set<string>;
  dupes: Set<string>;
  /** 整条链录过的总次数 */
  nTakes: number;
  /** 链上最近一次评分 */
  lastTotal: number | null;
  /** 云上 state.needs_rewrite（链上任一段被标过） */
  needsRewrite?: boolean;
}

/** recite.html 行内那一排标签，顺序原样；口径从「一个条目」改成「一条链」。 */
export function rowTags(row: LibraryRow, ctx: RowTagContext): RowTag[] {
  const th = row.thread;
  const items = th.items;
  const tags: RowTag[] = [];
  if (th.kindLabel) tags.push({ text: th.kindLabel, tone: 'plain' });
  // 目标秒数是整条链之和 —— 她想知道的是「这一题连追问一共要说多久」。
  if (th.targetSec) tags.push({ text: `${th.targetSec}s`, tone: 'plain' });
  tags.push(th.hasOrig ? { text: '🎧 原声', tone: 'good' } : { text: '无原声', tone: 'plain' });
  // 真实面试的题本来就没有念稿（整页是原始对话），别再挂「无念稿」当缺陷。
  if (!row.hasScript && !th.dialogMode) tags.push({ text: '无念稿 · 听+看点评', tone: 'warn' });
  if (row.followupCount) tags.push({ text: `追问 ${row.followupCount}`, tone: 'good' });
  if (items.some((i) => ctx.queueIds.has(i.id))) tags.push({ text: '今日', tone: 'note' });
  if (items.some((i) => ctx.dupes.has(i.id))) tags.push({ text: '🟡 撞车', tone: 'warn' });
  // bundle 里的 rough/deferred 和云上 needs_rewrite 是同一件事的两个来源，合成一个标签，
  // 不然同一行会挂两个「稿要改」。
  if (items.some((i) => i.quality === 'rough' || i.deferred) || ctx.needsRewrite) {
    tags.push({ text: '稿要改', tone: 'warn' });
  }
  // 有长版 = 这一条在练习页可以切短/长；库里先给一眼看得见的记号。
  if (items.some((i) => i.script_long)) tags.push({ text: '短/长', tone: 'note' });
  if (ctx.nTakes) {
    const last = ctx.lastTotal != null ? ` · 上次 ${ctx.lastTotal.toFixed(1)}` : '';
    tags.push({ text: `录过 ${ctx.nTakes} 次${last}`, tone: 'plain' });
  }
  return tags;
}

/** 把一条链上各段的云端状态汇总成行标签要的三个数。 */
export function aggregateRowState(
  row: LibraryRow,
  state: Record<string, ReciteState>,
  nTakesById: Record<string, number>,
): { nTakes: number; lastTotal: number | null; needsRewrite: boolean } {
  let nTakes = 0;
  let needsRewrite = false;
  let lastTotal: number | null = null;
  let lastAt = '';
  for (const item of row.thread.items) {
    const st = state[item.id] ?? {};
    nTakes += nTakesById[item.id] ?? st.n_takes ?? 0;
    if (st.needs_rewrite) needsRewrite = true;
    // 「上次多少分」取时间最近的那一段，不是链上第一段。
    if (st.last_total != null && (st.last_at ?? '') >= lastAt) {
      lastAt = st.last_at ?? '';
      lastTotal = st.last_total;
    }
  }
  return { nTakes, lastTotal, needsRewrite };
}

export interface LibraryCounts {
  /** 库里有多少条**题**（thread），不是多少个条目 */
  threads: number;
  all: number;
  companies: number;
  orig: number;
  rough: number;
  archived: number;
  noscript: number;
  thin: number;
}

export function libraryCounts(
  items: ReciteItem[],
  state: Record<string, ReciteState>,
  threadCount = 0,
): LibraryCounts {
  let orig = 0;
  let rough = 0;
  let noscript = 0;
  let thin = 0;
  const companies = new Set<string>();
  for (const it of items) {
    companies.add(it.co || '其他');
    if (it.has_orig) orig++;
    if (it.quality === 'rough' || it.deferred) rough++;
    if (!(it.script || '').trim()) noscript++;
    if (it.scope === 'thin') thin++;
  }
  const archived = Object.values(state).filter((s) => s?.archived).length;
  return {
    threads: threadCount || items.length,
    all: items.length,
    companies: companies.size,
    orig,
    rough,
    archived,
    noscript,
    thin,
  };
}

export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${`0${s % 60}`.slice(-2)}`;
}

/** 五维点阵：●●●○○ */
export function dots(n: number | null | undefined): string {
  const v = Math.max(0, Math.min(5, Math.round(n ?? 0)));
  return '●'.repeat(v) + '○'.repeat(5 - v);
}

// ── 稿子版本（短版 / 长版 / 原稿）─────────────────────────────────────────────

export interface VersionOption {
  id: ScriptVersion;
  /** 开关上的字 */
  label: string;
  /** 「这一遍：闭卷 · 长版 3–5 分钟」里那半句 */
  short: string;
}

/** 有 long 或 short 才谈得上切版本；两个都没有就是一份稿，开关不出现。 */
export function hasScriptVersions(item: ReciteItem): boolean {
  return Boolean(item.script_long || item.script_short);
}

/**
 * 开关上有哪几段。默认两段（短版 / 长版）；
 * `script_short` 为空时基稿本身就是短的，额外给一段「原稿」，好让 take 的 version 记成 base
 * 而不是假装成 short（M4 §4 / PM batch 2 §2）。
 */
export function versionOptions(item: ReciteItem): VersionOption[] {
  if (!hasScriptVersions(item)) return [];
  const out: VersionOption[] = [{ id: 'short', label: '短版 · 1–2 分钟', short: '短版 1–2 分钟' }];
  if (item.script_long) out.push({ id: 'long', label: '长版 · 3–5 分钟', short: '长版 3–5 分钟' });
  if (!item.script_short) out.push({ id: 'base', label: '原稿', short: '原稿' });
  return out;
}

export interface ResolvedVersion {
  version: ScriptVersion;
  script: string | null;
  gloss: string;
  targetSec: number;
  /** 显示用的短标签；没有版本可切时是空串 */
  label: string;
}

/** 选中的版本决定：显示的稿、中文对照、目标秒数、上传 meta 的 version。 */
export function resolveVersion(item: ReciteItem, version: ScriptVersion): ResolvedVersion {
  const base: ResolvedVersion = {
    version: 'base',
    script: item.script,
    gloss: item.script_zh_gloss,
    targetSec: item.target_sec,
    label: '',
  };
  if (!hasScriptVersions(item)) return base;
  const opts = versionOptions(item);
  const picked = opts.find((o) => o.id === version) ?? opts[0];
  if (picked.id === 'long') {
    return {
      version: 'long',
      script: item.script_long,
      gloss: item.gloss_long || item.script_zh_gloss,
      targetSec: item.target_sec_long ?? item.target_sec,
      label: picked.short,
    };
  }
  if (picked.id === 'short') {
    return {
      version: 'short',
      script: item.script_short ?? item.script,
      gloss: item.gloss_short || item.script_zh_gloss,
      targetSec: item.target_sec_short ?? item.target_sec,
      label: picked.short,
    };
  }
  return { ...base, label: picked.short };
}

export interface ScriptSegment {
  text: string;
  canon: boolean;
}

/**
 * 把念稿切成「按原文的跨度」和「其余」两种片段，好在左栏把 canon 高亮出来。
 * 跨度按出现位置排序、互不重叠；找不到的跨度直接忽略（稿子改过就会这样）。
 */
export function splitCanon(script: string, spans: string[]): ScriptSegment[] {
  const hits: Array<{ start: number; end: number }> = [];
  for (const raw of spans) {
    const span = (raw || '').trim();
    if (!span) continue;
    let from = 0;
    for (;;) {
      const at = script.indexOf(span, from);
      if (at < 0) break;
      if (!hits.some((h) => at < h.end && at + span.length > h.start)) {
        hits.push({ start: at, end: at + span.length });
        break;
      }
      from = at + 1;
    }
  }
  hits.sort((a, b) => a.start - b.start);
  const out: ScriptSegment[] = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.start > cursor) out.push({ text: script.slice(cursor, h.start), canon: false });
    out.push({ text: script.slice(h.start, h.end), canon: true });
    cursor = h.end;
  }
  if (cursor < script.length) out.push({ text: script.slice(cursor), canon: false });
  return out.length ? out : [{ text: script, canon: false }];
}

/** 今日推荐横条上那一颗颗小胶囊的文字。截断了就补省略号，不然读起来像句子写坏了。 */
export function queueChipLabel(item: ReciteItem): string {
  const raw = item.question_zh || item.question || item.id;
  return raw.length > 26 ? `${raw.slice(0, 26)}…` : raw;
}

/** 段头上那一行：「追问 2 · 45s」这种。 */
export function segmentSecLabel(sec: number): string {
  return sec ? `${sec}s` : '';
}
