import { Platform } from 'react-native';
import type { ScriptVersion } from './types';

/**
 * 「今日推荐」横条关掉就记住 —— 它是提示不是闸门（M4 §0 决定 1）。
 * web 用 localStorage（和 jobscan 的 recite_recbar 同义），原生退回进程内存：
 * 这个偏好的代价只有「下次打开又展开一次」，不值得为它多一次 sqlite 写。
 */

const KEY = 'atoms.recite.recbar';
/** 上次选的稿子版本（短版 / 长版 / 原稿）。默认短版 —— 她说先把 1–2 分钟那版练熟。 */
const VERSION_KEY = 'recite.version';
let memory: Record<string, string> = {};

function browser(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function read(key: string): string | null {
  if (browser()) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  return memory[key] ?? null;
}

function write(key: string, value: string): void {
  if (browser()) {
    try {
      window.localStorage.setItem(key, value);
      return;
    } catch {
      // Safari 无痕模式会直接抛 —— 退回内存，不让一个偏好把页面炸掉
    }
  }
  memory = { ...memory, [key]: value };
}

export function recBarHidden(): boolean {
  return read(KEY) === 'off';
}

export function setRecBarHidden(hidden: boolean): void {
  write(KEY, hidden ? 'off' : 'on');
}

export function scriptVersionPref(): ScriptVersion {
  const v = read(VERSION_KEY);
  return v === 'long' || v === 'base' || v === 'short' ? v : 'short';
}

export function setScriptVersionPref(v: ScriptVersion): void {
  write(VERSION_KEY, v);
}
