import { Platform } from 'react-native';
import { ApiError, mark } from './api';
import type { PracticeStep } from './types';

/**
 * 三遍练习法的网络层：直发优先，发不出去进本地队列，之后任何一次成功发送
 * （或练习页重新挂载）顺带补传。纯逻辑（步骤定义/计数）在 library.ts。
 *
 * 队列存 localStorage（web；和 prefs.ts 同一套护栏），原生退回进程内存 ——
 * 代价只是「原生端断网时的勾可能丢」，而念稿练习的主战场是 atoms-web。
 * 时间戳由服务端在收到时打：离线补传的勾会比实际练习时刻晚，可接受，
 * 换来的是三个框的语义永远是「服务器见证过的完成」。
 */

interface PendingMark {
  id: string;
  step: PracticeStep;
  on: boolean;
}

const QKEY = 'atoms.recite.practice.queue';
let memoryQueue: PendingMark[] = [];

function browser(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readQueue(): PendingMark[] {
  if (browser()) {
    try {
      return JSON.parse(window.localStorage.getItem(QKEY) || '[]') as PendingMark[];
    } catch {
      return [];
    }
  }
  return memoryQueue;
}

function writeQueue(q: PendingMark[]): void {
  if (browser()) {
    try {
      if (q.length) window.localStorage.setItem(QKEY, JSON.stringify(q));
      else window.localStorage.removeItem(QKEY);
      return;
    } catch {
      // Safari 无痕模式会抛 —— 退回内存，别让一个勾把页面炸掉
    }
  }
  memoryQueue = q;
}

/** 同一段同一步只留最后一次点击（勾了又取消 = 只发取消）。 */
function enqueue(p: PendingMark): void {
  const q = readQueue().filter((x) => !(x.id === p.id && x.step === p.step));
  q.push(p);
  writeQueue(q);
}

export function hasQueuedPractice(): boolean {
  return readQueue().length > 0;
}

/** 还没送达的勾（练习页挂载时用它播种本地显示：队列里的值比服务器/缓存的新）。 */
export function peekQueuedPractice(): ReadonlyArray<PendingMark> {
  return readQueue();
}

let flushPromise: Promise<number> | null = null;

/** 顺序补传队列，返回成功送达的条数；发不出去就停（保序），剩下的留给下一次。
 * 已有一轮在跑就共享它的 Promise —— 循环每圈现读队列，跑着的这轮自然会把新勾带走，
 * 等它结束再看队列空不空就是准的。
 *
 * 两条 review 抓出来的坑，改这里前先读：
 * ① 不许拿循环外的快照回写 —— await 期间新点的勾会进 storage，快照 slice 回写会把它
 *    整个抹掉（勾了却永远不上传、也不重试）。所以每一圈都现读现删，且只在队头还是
 *    「刚发出去的那一条」时才删：同键新点击会顶掉旧条目（去重在队尾重插），头不匹配
 *    说明发出去的已是旧值，留给下一圈发新值。JS 单线程，同步段之间不会被插队，
 *    只有 await 点要防 —— 所以「读→比→删」三步之间不能有 await。
 * ② 4xx（服务器收到并明确拒绝，比如部署错位导致的 404）直接丢弃这一条继续走，
 *    否则一颗毒丸卡住队头，之后所有勾永远同步不上去。断网/5xx/口令失效才留队重试。 */
export function flushPracticeQueue(): Promise<number> {
  if (!flushPromise) {
    flushPromise = doFlush().finally(() => {
      flushPromise = null;
    });
  }
  return flushPromise;
}

async function doFlush(): Promise<number> {
  let sent = 0;
  for (;;) {
    const q = readQueue();
    if (!q.length) break;
    const p = q[0];
    try {
      await mark(p.id, 'practice', { step: p.step, on: p.on });
      sent++;
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      if (!(status >= 400 && status < 500)) break; // 网络不通/5xx：整队留着下次
      // 4xx：落到下面的删头逻辑，条目丢弃
    }
    const now = readQueue();
    if (now.length && sameMark(now[0], p)) writeQueue(now.slice(1));
    // 头不匹配 = await 期间同键被新点击顶掉了，什么都不删，下一圈发新值
  }
  return sent;
}

function sameMark(a: PendingMark, b: PendingMark): boolean {
  return a.id === b.id && a.step === b.step && a.on === b.on;
}

/** 勾/取消一步。返回 true=已到服务器，false=还在本地队列等补传。
 * 一律「先进队、随即冲队」而不是直发：队列里有欠账时直发会被之后的补传
 * 反向覆盖（旧勾盖新勾），统一走队列天然保序。 */
export async function sendPracticeMark(id: string, step: PracticeStep, on: boolean): Promise<boolean> {
  enqueue({ id, step, on });
  await flushPracticeQueue();
  return !hasQueuedPractice();
}
