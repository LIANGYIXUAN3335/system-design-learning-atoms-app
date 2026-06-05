import type { ReciteItem, ReciteThread, ReciteThreadSegment } from './types';

/**
 * 题 + 追问链（thread）—— 库和练习页的单位。
 *
 * 她 2026-09-03 的原话（转述）：「Amazon 那场 2–5 是同一个项目的不同追问，6–11 是第二问。
 * 拆成一行一条是错的。一题一张卡：主问题 → 我的回答（能播）→ 追问 1 → 我的回答 → 追问 2 …
 * 我要听的是他为什么一直追问。」
 *
 * 分组由 `src/content/recite.threads.json` 给（内容侧一个 grouping agent 在产）。
 * 那个文件现在还是空数组，所以这里必须能在**没有分组**时正常工作：没被任何 thread 收走的条目，
 * 各自派生成一条单段 thread。这样 336 条一条不丢，UI 也和分组落地前后一致。
 */

export interface ResolvedSegment {
  segment: ReciteThreadSegment;
  item: ReciteItem;
  /** merge_into_prev：并进上一段当子行，不给自己的稿和录音面板 */
  merged: boolean;
}

export interface ResolvedThread {
  thread: ReciteThread;
  segments: ResolvedSegment[];
  /** 主问题那一段。永远存在（缺 main 就把第一段当主问题）。 */
  main: ResolvedSegment;
  items: ReciteItem[];
  /** 追问段数（不含主问题） */
  followupCount: number;
  /** 各段目标秒数之和 —— 库里显示的是整条链要说多久 */
  targetSec: number;
  hasOrig: boolean;
  hasScript: boolean;
  /** 真的来自 threads.json（false = 单条派生出来的） */
  grouped: boolean;
  /**
   * 真实面试的题（interview / reference）：整页就是**当时的原始对话**。
   * 她 2026-09-03 的原话：「我要的是原文：我说了什么、面试官说了什么，一来一回完整的对话。
   * 就地点评、要点、念稿全文都不要 —— 念稿这件事是即兴发挥的，不是先写好再念。」
   * playbook / opener 不是这一档：那些本来就是先写好再练的稿，保留念稿 + 要点 + 版本开关。
   */
  dialogMode: boolean;
  /** 行上那个类型标签：真 thread 用 thread.kind，派生的沿用条目自己的 kind（更具体） */
  kindLabel: string;
  co: string;
  interview: string;
  /** 搜索串：所有段的中英题面 + 场次 + item id + thread 标题 */
  search: string;
}

const UNGROUPED_SESSION = '（未分场）';

/** 没有分组时，一条条目自己就是一条单段 thread。 */
function deriveThread(item: ReciteItem): ReciteThread {
  return {
    thread_id: `th1:${item.id}`,
    interview: item.interview || UNGROUPED_SESSION,
    kind: 'other',
    title: item.question || '',
    title_zh: item.question_zh || '',
    segments: [{ item_id: item.id, role: 'main', label: '主问题' }],
    chain_note_zh: '',
  };
}

function resolve(thread: ReciteThread, byId: Map<string, ReciteItem>, grouped: boolean): ResolvedThread | null {
  const segments: ResolvedSegment[] = [];
  for (const segment of thread.segments) {
    const item = byId.get(segment.item_id);
    if (!item) continue; // 分组表引用了 bundle 里没有的条目 —— 忽略，不让整条 thread 消失
    segments.push({ segment, item, merged: Boolean(segment.merge_into_prev) && segments.length > 0 });
  }
  if (!segments.length) return null;
  const main = segments.find((s) => s.segment.role === 'main') ?? segments[0];
  const items = segments.map((s) => s.item);
  const searchParts = [thread.title, thread.title_zh, thread.interview];
  for (const s of segments) {
    searchParts.push(s.item.question, s.item.question_zh, s.item.id);
  }
  return {
    thread,
    segments,
    main,
    items,
    dialogMode: main.item.source === 'interview' || main.item.source === 'reference',
    followupCount: segments.filter((s) => s.segment.role === 'followup').length,
    targetSec: items.reduce((n, i) => n + (i.target_sec || 0), 0),
    hasOrig: items.some((i) => i.has_orig),
    hasScript: items.some((i) => Boolean((i.script || '').trim())),
    grouped,
    kindLabel: grouped ? thread.kind : main.item.kind || 'other',
    co: main.item.co || '其他',
    interview: main.item.interview || UNGROUPED_SESSION,
    search: searchParts.filter(Boolean).join(' ').toLowerCase(),
  };
}

/**
 * 分组表 + bundle → thread 列表。
 * 顺序跟着**主问题在 bundle 里的位置**走，所以公司/场次的排序和分组落地前后是同一套。
 */
export function buildThreads(items: ReciteItem[], raw: ReciteThread[]): ResolvedThread[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const order = new Map(items.map((i, k) => [i.id, k]));
  const taken = new Set<string>();
  const out: ResolvedThread[] = [];

  for (const thread of raw ?? []) {
    const resolved = resolve(thread, byId, true);
    if (!resolved) continue;
    for (const s of resolved.segments) taken.add(s.item.id);
    out.push(resolved);
  }
  for (const item of items) {
    if (taken.has(item.id)) continue;
    const resolved = resolve(deriveThread(item), byId, false);
    if (resolved) out.push(resolved);
  }
  out.sort((a, b) => (order.get(a.main.item.id) ?? 0) - (order.get(b.main.item.id) ?? 0));
  return out;
}

export function threadById(threads: ResolvedThread[], id: string): ResolvedThread | null {
  return threads.find((t) => t.thread.thread_id === id) ?? null;
}

/** 某个条目属于哪条 thread —— 今日推荐的胶囊拿的是 item_id，要映射回 thread。 */
export function threadOfItem(threads: ResolvedThread[], itemId: string): ResolvedThread | null {
  return threads.find((t) => t.items.some((i) => i.id === itemId)) ?? null;
}

/** 同一场次里的邻居，按主问题的 item id 排 —— 练完一条能直接跳下一条。 */
export function threadSiblings(threads: ResolvedThread[], thread: ResolvedThread): ResolvedThread[] {
  return threads
    .filter((t) => t.interview === thread.interview)
    .sort((a, b) => a.main.item.id.localeCompare(b.main.item.id));
}
