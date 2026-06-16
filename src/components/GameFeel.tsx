import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';

/**
 * 「游戏的劲儿」的三个画面件（docs/DESIGN_game-feel_2026-10-11.md §2 / §7）：
 *  - SoftTimerRing：A1 翻面前右上角的细进度环。走满就停在满环；不翻面、不扣分、不变红。
 *  - useWinPulse + WinFlash + PlusOne：A2 小档，答对时卡片边缘绿光一闪 + 底部「+1」弹起，共 0.3 秒。
 *  - BigCelebration：A2 大档，一组做完时全屏 1.8 秒的庆祝。
 * 只用 RN 自带的 Animated（没装 reanimated，不为这个加大依赖）。
 */

const NATIVE_DRIVER = Platform.OS !== 'web';
/** 铺满父容器（RN 0.86 去掉了 FILL） */
const FILL = { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 } as const;

// ---- A1 软计时环 ----------------------------------------------------------

/**
 * 两个半圆裁切 + 旋转画出一个弧（不用 SVG）：右半边管 0–50%，左半边管 50–100%。
 * 每个半边里放一个「只有半圈边框有颜色」的圆，转多少度就露出多少弧。
 */
export function SoftTimerRing({
  durationMs,
  size = 22,
  stroke = 2.5,
  style,
}: {
  durationMs: number;
  size?: number;
  stroke?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const progress = useRef(new Animated.Value(0)).current;

  // 走满就停在满环；不回调、不翻面、不扣分（2026-10-12 拍板）。数字正计时由外层接着走。
  useEffect(() => {
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: Math.max(1000, durationMs),
      easing: Easing.linear,
      useNativeDriver: NATIVE_DRIVER,
    });
    anim.start();
    return () => anim.stop();
  }, [durationMs, progress]);

  const half = size / 2;
  const circle = { width: size, height: size, borderRadius: half, borderWidth: stroke };

  const rightRot = progress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['45deg', '225deg', '225deg'],
  });
  const leftRot = progress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['45deg', '45deg', '225deg'],
  });

  return (
    <View accessibilityLabel="计时环" style={[{ width: size, height: size, pointerEvents: 'none' }, style]}>
      <View style={[FILL, circle, { borderColor: colors.line }]} />
      {/* 右半边：0 → 50% */}
      <View style={{ position: 'absolute', left: half, top: 0, width: half, height: size, overflow: 'hidden' }}>
        <Animated.View
          style={[
            circle,
            {
              position: 'absolute',
              left: -half,
              top: 0,
              borderColor: 'transparent',
              borderLeftColor: colors.accent,
              borderBottomColor: colors.accent,
              transform: [{ rotate: rightRot }],
            },
          ]}
        />
      </View>
      {/* 左半边：50% → 100% */}
      <View style={{ position: 'absolute', left: 0, top: 0, width: half, height: size, overflow: 'hidden' }}>
        <Animated.View
          style={[
            circle,
            {
              position: 'absolute',
              left: 0,
              top: 0,
              borderColor: 'transparent',
              borderTopColor: colors.accent,
              borderRightColor: colors.accent,
              transform: [{ rotate: leftRot }],
            },
          ]}
        />
      </View>
    </View>
  );
}

// ---- A2 小档：答对一闪 ------------------------------------------------------

/** 总时长 ≤ 0.3 秒（§2 A2 小档）。 */
export const WIN_PULSE_MS = 300;

export function useWinPulse(): { value: Animated.Value; fire: () => void } {
  const value = useRef(new Animated.Value(0)).current;
  const fire = useCallback(() => {
    value.stopAnimation();
    value.setValue(0);
    Animated.timing(value, {
      toValue: 1,
      duration: WIN_PULSE_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: NATIVE_DRIVER,
    }).start(({ finished }) => {
      if (finished) value.setValue(0);
    });
  }, [value]);
  return { value, fire };
}

/** 卡片边缘的绿光：盖在卡片上的一圈绿边，亮一下就灭。 */
export function WinFlash({ pulse, radius = 16 }: { pulse: Animated.Value; radius?: number }) {
  const { colors } = useTheme();
  const opacity = pulse.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 0] });
  return (
    <Animated.View
      style={[
        FILL,
        { pointerEvents: 'none', borderRadius: radius, borderWidth: 3, borderColor: colors.ok, opacity },
      ]}
    />
  );
}

/** 屏幕底部弹起的「+1」。 */
export function PlusOne({ pulse }: { pulse: Animated.Value }) {
  const { colors } = useTheme();
  const opacity = pulse.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 1, 1, 0] });
  const translateY = pulse.interpolate({ inputRange: [0, 1], outputRange: [12, -36] });
  const scale = pulse.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.7, 1.15, 1] });
  return (
    <View style={styles.plusOneDock}>
      <Animated.Text
        style={[
          styles.plusOne,
          { color: colors.ok, backgroundColor: colors.okBg, opacity, transform: [{ translateY }, { scale }] },
        ]}
      >
        +1
      </Animated.Text>
    </View>
  );
}

// ---- A2 大档：一组做完的全屏庆祝 ---------------------------------------------

/** 1.5–2 秒（§2 A2 大档）。 */
export const BIG_CELEBRATION_MS = 1800;

interface Particle {
  dx: number;
  dy: number;
  spin: string;
  color: string;
  size: number;
  round: boolean;
}

export function BigCelebration({ headline }: { headline?: string | null }) {
  const { colors } = useTheme();
  const t = useRef(new Animated.Value(0)).current;
  const [visible, setVisible] = useState(true);

  const particles = useMemo<Particle[]>(() => {
    const palette = [colors.ok, colors.accent, '#e2a33b', colors.tealInk, '#e86f9a'];
    return Array.from({ length: 22 }, (_, i) => {
      const angle = (i / 22) * Math.PI * 2 + Math.random() * 0.4;
      const dist = 110 + Math.random() * 120;
      return {
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist,
        spin: `${Math.round((Math.random() - 0.5) * 720)}deg`,
        color: palette[i % palette.length],
        size: 7 + Math.round(Math.random() * 6),
        round: i % 3 === 0,
      };
    });
  }, [colors]);

  useEffect(() => {
    Animated.timing(t, {
      toValue: 1,
      duration: BIG_CELEBRATION_MS,
      easing: Easing.linear,
      useNativeDriver: NATIVE_DRIVER,
    }).start(({ finished }) => {
      if (finished) setVisible(false);
    });
    return () => t.stopAnimation();
  }, [t]);

  if (!visible) return null;

  const wash = t.interpolate({ inputRange: [0, 0.12, 0.7, 1], outputRange: [0, 0.6, 0.35, 0] });
  const emojiScale = t.interpolate({ inputRange: [0, 0.18, 0.32, 1], outputRange: [0.3, 1.25, 1, 1] });
  const emojiOpacity = t.interpolate({ inputRange: [0, 0.08, 0.8, 1], outputRange: [0, 1, 1, 0] });

  return (
    <View style={[FILL, { pointerEvents: 'none' }]}>
      <Animated.View style={[FILL, { backgroundColor: colors.okBg, opacity: wash }]} />
      <View style={styles.burstCenter}>
        {particles.map((p, i) => {
          // 前 45% 的时间向外炸开，之后带点重力往下掉、慢慢淡出
          const x = t.interpolate({ inputRange: [0, 0.45, 1], outputRange: [0, p.dx, p.dx * 1.15] });
          const y = t.interpolate({ inputRange: [0, 0.45, 1], outputRange: [0, p.dy, p.dy + 90] });
          const opacity = t.interpolate({ inputRange: [0, 0.05, 0.75, 1], outputRange: [0, 1, 1, 0] });
          const rotate = t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', p.spin] });
          return (
            <Animated.View
              key={i}
              style={{
                position: 'absolute',
                width: p.size,
                height: p.round ? p.size : p.size * 0.6,
                borderRadius: p.round ? p.size / 2 : 2,
                backgroundColor: p.color,
                opacity,
                transform: [{ translateX: x }, { translateY: y }, { rotate }],
              }}
            />
          );
        })}
        <Animated.View style={{ alignItems: 'center', opacity: emojiOpacity, transform: [{ scale: emojiScale }] }}>
          <Text style={{ fontSize: 72 }}>🎉</Text>
          {headline ? (
            <Text style={{ fontSize: 22, fontWeight: '800', color: colors.ok, marginTop: 6 }}>{headline}</Text>
          ) : null}
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  plusOneDock: { position: 'absolute', left: 0, right: 0, bottom: 56, alignItems: 'center', pointerEvents: 'none' },
  plusOne: {
    fontSize: 22,
    fontWeight: '800',
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 99,
    overflow: 'hidden',
  },
  burstCenter: { ...FILL, alignItems: 'center', justifyContent: 'center' },
});
