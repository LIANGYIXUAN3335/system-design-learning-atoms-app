import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../theme';

/**
 * 一条带标签的音轨 · web 实现。
 *
 * react-native-web 渲染进的就是 React DOM，所以这里可以直接写一个 `<audio controls>`：
 * 浏览器原生控件自带拖动、倒回、时间显示，比自己画一条滑块好用得多。
 * 「点对话某一句跳播」通过 ref 上的 seekTo/play 走。内容和 AudioTrack.tsx 相同
 * （基文件按 MermaidView 的惯例保持 web-safe），原生走 AudioTrack.native.tsx。
 */

export interface AudioTrackHandle {
  seekTo(sec: number): void;
  play(): void;
  pause(): void;
}

export interface AudioTrackProps {
  /** 标签行，比如「🎧 面试原声（我当时说的）」；不给就不画标签 */
  label?: string;
  /** 音频地址；null = 还没有（比如还没录），控件置灰 */
  src: string | null;
  autoPlay?: boolean;
  /** 历次录音那种一行一个的小号 */
  compact?: boolean;
  /** 跳到第几秒开始播；配合 seekSeq 用（同一个秒数点第二次也要生效） */
  startAt?: number;
  /** 每点一次「跳到这一句」就 +1 —— 它变了才真的去 seek */
  seekSeq?: number;
}

export const AudioTrack = forwardRef<AudioTrackHandle, AudioTrackProps>(function AudioTrack(
  { label, src, autoPlay, compact, startAt, seekSeq },
  ref,
) {
  const { colors } = useTheme();
  const elRef = useRef<HTMLAudioElement | null>(null);

  // 点对话里的某一句 → 跳到那一秒开播。元数据没加载完时 currentTime 会被忽略，
  // 所以没 ready 就挂一次 loadedmetadata。
  useEffect(() => {
    const el = elRef.current;
    if (!el || startAt == null || seekSeq == null) return;
    const apply = () => {
      el.currentTime = Math.max(0, startAt);
      void el.play().catch(() => {});
    };
    if (el.readyState > 0) apply();
    else el.addEventListener('loadedmetadata', apply, { once: true });
    return () => el.removeEventListener('loadedmetadata', apply);
  }, [seekSeq, startAt, src]);

  useImperativeHandle(
    ref,
    () => ({
      seekTo(sec: number) {
        const el = elRef.current;
        if (el) el.currentTime = Math.max(0, sec);
      },
      play() {
        void elRef.current?.play().catch(() => {});
      },
      pause() {
        elRef.current?.pause();
      },
    }),
    [],
  );

  const body = src ? (
    <audio
      ref={elRef}
      controls
      preload="none"
      autoPlay={autoPlay}
      src={src}
      style={{ width: '100%', height: compact ? 30 : 34, display: 'block' }}
    />
  ) : (
    <Text style={{ fontSize: 12.5, color: colors.muted }}>音频不可用（服务没配好或没口令）</Text>
  );

  if (compact) return <View style={{ flex: 1, minWidth: 0 }}>{body}</View>;

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: 9,
        paddingVertical: 8,
        paddingHorizontal: 10,
        marginBottom: 8,
        backgroundColor: colors.card,
      }}
    >
      {label ? (
        <Text style={{ fontSize: 12.5, color: colors.muted, marginBottom: 4 }}>{label}</Text>
      ) : null}
      {body}
    </View>
  );
});
