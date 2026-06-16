import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

/**
 * A2 的「手感」：震动 + 音效（docs/DESIGN_game-feel_2026-10-11.md §2 A2 / §7）。
 *
 * 硬规矩：只在「做成了」时调用。答错 / 不会 / 超时，调用方一律不调这里——没有震动、没有声音。
 *
 * expo-haptics 是 2026-10-11 新装的原生模块：旧的安装包里没有它，静态 import 会在启动时
 * 直接抛错把整个 app 弄崩。所以这里懒加载 + try/catch，没有就安静地不震。
 * 所有失败一律吞掉——手感是锦上添花，不能让刷题卡住。
 */

type HapticsModule = typeof import('expo-haptics');
let hapticsModule: HapticsModule | null | undefined;

function haptics(): HapticsModule | null {
  if (hapticsModule !== undefined) return hapticsModule;
  try {
    hapticsModule = require('expo-haptics') as HapticsModule;
  } catch {
    hapticsModule = null;
  }
  return hapticsModule;
}

function vibrate(strength: 'light' | 'medium'): void {
  const h = haptics();
  if (!h) return;
  try {
    const style = strength === 'light' ? h.ImpactFeedbackStyle.Light : h.ImpactFeedbackStyle.Medium;
    void h.impactAsync(style).catch(() => {});
  } catch {
    // 没有震动马达 / 网页不支持：安静跳过
  }
}

// 两个音都是用 Python 标准库合成的（见 docs/DESIGN_game-feel_2026-10-11.md「实现记录」）。
const SOURCES = {
  ding: require('../assets/sfx/ding.wav'),
  fanfare: require('../assets/sfx/fanfare.wav'),
} as const;

type SfxName = keyof typeof SOURCES;
const players: Partial<Record<SfxName, AudioPlayer | null>> = {};

function player(name: SfxName): AudioPlayer | null {
  let p = players[name];
  if (p !== undefined) return p;
  try {
    p = createAudioPlayer(SOURCES[name]);
  } catch {
    p = null;
  }
  players[name] = p;
  return p;
}

/** 启动时先把两个音加载好，第一次答对就不会慢半拍。 */
export function preloadSfx(): void {
  player('ding');
  player('fanfare');
}

function playSfx(name: SfxName): void {
  const p = player(name);
  if (!p) return;
  try {
    // 连着答对时上一声可能还没放完：倒回开头再放，不叠音。
    void p.seekTo(0).catch(() => {});
    p.play();
  } catch {
    // 放不出来就算了
  }
}

/** 小档：每张答对——轻震 + 「叮」。 */
export function feelSmallWin(soundOn: boolean): void {
  vibrate('light');
  if (soundOn) playSfx('ding');
}

/** 大档：一组做完 / 连续 7·30·100 天——中震 + 三音上行。 */
export function feelBigWin(soundOn: boolean): void {
  vibrate('medium');
  if (soundOn) playSfx('fanfare');
}
