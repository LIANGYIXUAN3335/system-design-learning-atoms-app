import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { LayoutChangeEvent, Pressable, Text, View } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useTheme } from '../theme';
import { fmtClock } from '../recite/library';

/**
 * 一条带标签的音轨 · iOS/Android 实现（expo-audio SDK 57）。
 *
 * 没有原生 <audio controls>，所以自己画：⏵/⏸ + 一条可点击定位的进度条 + 当前/总时长。
 * `useAudioPlayer(source)` 内部按 JSON.stringify(source) 建对象，所以 src 变了会自动换源；
 * seekTo 是 async，这里刻意不 await —— 调用方（点对话某一句）只想立刻听到声音。
 */

export interface AudioTrackHandle {
  seekTo(sec: number): void;
  play(): void;
  pause(): void;
}

export interface AudioTrackProps {
  label?: string;
  src: string | null;
  autoPlay?: boolean;
  compact?: boolean;
  startAt?: number;
  seekSeq?: number;
}

export const AudioTrack = forwardRef<AudioTrackHandle, AudioTrackProps>(function AudioTrack(
  { label, src, autoPlay, compact, startAt, seekSeq },
  ref,
) {
  const { colors } = useTheme();
  const player = useAudioPlayer(src ?? null);
  const status = useAudioPlayerStatus(player);
  const [width, setWidth] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    started.current = false;
  }, [src]);

  useEffect(() => {
    if (autoPlay && src && status.isLoaded && !started.current) {
      started.current = true;
      try {
        player.play();
      } catch {
        // 播不出来不该把这一页炸掉
      }
    }
  }, [autoPlay, src, status.isLoaded, player]);

  // 点对话里的某一句 → 跳到那一秒开播；源还没加载好就等 isLoaded 再跳。
  const wantSeek = useRef<{ seq: number; at: number } | null>(null);
  useEffect(() => {
    if (startAt == null || seekSeq == null) return;
    wantSeek.current = { seq: seekSeq, at: startAt };
  }, [seekSeq, startAt]);
  useEffect(() => {
    const want = wantSeek.current;
    if (!want || !status.isLoaded) return;
    wantSeek.current = null;
    void player
      .seekTo(Math.max(0, want.at))
      .then(() => {
        try {
          player.play();
        } catch {
          /* 忽略 */
        }
      })
      .catch(() => {});
  }, [seekSeq, status.isLoaded, player]);

  useImperativeHandle(
    ref,
    () => ({
      seekTo(sec: number) {
        void player.seekTo(Math.max(0, sec)).catch(() => {});
      },
      play() {
        try {
          player.play();
        } catch {
          /* 忽略 */
        }
      },
      pause() {
        try {
          player.pause();
        } catch {
          /* 忽略 */
        }
      },
    }),
    [player],
  );

  const duration = status.duration || 0;
  const current = status.currentTime || 0;
  const ratio = duration > 0 ? Math.min(1, current / duration) : 0;

  const seekAtX = (x: number) => {
    if (!duration || !width) return;
    void player.seekTo(Math.max(0, Math.min(duration, (x / width) * duration))).catch(() => {});
  };

  const disabled = !src;

  const controls = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Pressable
        disabled={disabled}
        onPress={() => (status.playing ? player.pause() : player.play())}
        hitSlop={8}
        style={{
          width: compact ? 28 : 32,
          height: compact ? 28 : 32,
          borderRadius: 99,
          borderWidth: 1,
          borderColor: colors.line,
          backgroundColor: status.playing ? colors.accent : colors.card,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.4 : 1,
        }}
      >
        <Text style={{ fontSize: 13, color: status.playing ? '#fff' : colors.ink }}>
          {status.playing ? '⏸' : '⏵'}
        </Text>
      </Pressable>
      <Pressable
        disabled={disabled}
        style={{ flex: 1, paddingVertical: 8 }}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        onPress={(e) => seekAtX(e.nativeEvent.locationX)}
      >
        <View style={{ height: 5, borderRadius: 99, backgroundColor: colors.line, overflow: 'hidden' }}>
          <View style={{ height: '100%', width: `${ratio * 100}%`, backgroundColor: colors.accent }} />
        </View>
      </Pressable>
      <Text style={{ fontSize: 11.5, color: colors.muted, fontVariant: ['tabular-nums'] }}>
        {fmtClock(current)} / {duration ? fmtClock(duration) : '–:––'}
      </Text>
    </View>
  );

  if (compact) return <View style={{ flex: 1, minWidth: 0 }}>{controls}</View>;

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
      {src ? (
        controls
      ) : (
        <Text style={{ fontSize: 12.5, color: colors.muted }}>音频不可用（服务没配好或没口令）</Text>
      )}
    </View>
  );
});
