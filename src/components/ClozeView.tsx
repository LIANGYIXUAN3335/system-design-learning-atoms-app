import React from 'react';
import { Text } from 'react-native';
import { parseCloze } from '../logic/cloze';
import { useTheme } from '../theme';

/**
 * Reveal-style cloze (prototype parity — see atoms-m1-review.md §2.3):
 * blanks show as ＿＿ until revealed, then show the answer in ok-green.
 */
export function ClozeView({ text, revealed }: { text: string; revealed: boolean }) {
  const { colors } = useTheme();
  const segments = parseCloze(text);
  return (
    <Text style={{ fontSize: 16, lineHeight: 26, color: colors.ink }}>
      {segments.map((seg, i) =>
        seg.type === 'text' ? (
          <Text key={i}>{seg.value}</Text>
        ) : (
          <Text
            key={i}
            style={{
              color: revealed ? colors.ok : colors.accent,
              fontWeight: '600',
              textDecorationLine: 'underline',
            }}
          >
            {revealed ? ` ${seg.value} ` : ' ＿＿＿ '}
          </Text>
        ),
      )}
    </Text>
  );
}
