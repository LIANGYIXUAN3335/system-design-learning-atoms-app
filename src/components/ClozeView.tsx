import React from 'react';
import { Text, View } from 'react-native';
import { parseCloze } from '../logic/cloze';
import { useTheme } from '../theme';

/**
 * Reveal-style cloze (prototype parity — see atoms-m1-review.md §2.3):
 * blanks show as ＿＿ until revealed, then show the answer in ok-green.
 */
function ClozeText({
  text,
  revealed,
  muted,
}: {
  text: string;
  revealed: boolean;
  muted?: boolean;
}) {
  const { colors } = useTheme();
  const segments = parseCloze(text);
  return (
    <Text
      style={{
        fontSize: muted ? 12.5 : 16,
        lineHeight: muted ? 19 : 26,
        color: muted ? colors.muted : colors.ink,
        marginTop: muted ? 5 : 0,
      }}
    >
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

export function ClozeView({
  text,
  textEn,
  revealed,
}: {
  text: string;
  textEn?: string;
  revealed: boolean;
}) {
  const english = textEn?.trim();
  return (
    <View>
      <ClozeText text={text} revealed={revealed} />
      {english ? <ClozeText text={english} revealed={revealed} muted /> : null}
    </View>
  );
}
