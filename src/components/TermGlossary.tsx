import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { chooseConceptVisual, detectTerms } from '../logic/terms';
import { useTheme } from '../theme';
import type { Card } from '../types';
import { MermaidView } from './MermaidView';

export function TermGlossary({ card }: { card: Card }) {
  const { colors } = useTheme();
  const detectedTerms = useMemo(() => detectTerms(card), [card]);
  const terms = useMemo(() => {
    const manualTerms =
      card.termDefinitions?.map((term, index) => ({
        label: term.term,
        aliases: [term.term],
        // abbreviations must show their expansion — "CRDT (Conflict-free
        // Replicated Data Type)", never "CRDT (CRDT)"
        englishName: term.fullName ?? term.term,
        meaning: term.meaning,
        meaningEn: term.meaningEn ?? term.meaning,
        index: -1000 + index,
        matchLength: term.term.length,
      })) ?? [];
    const seen = new Set<string>();
    return [...manualTerms, ...detectedTerms].filter((term) => {
      const key = term.label.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [card.termDefinitions, detectedTerms]);
  const visual = useMemo(() => chooseConceptVisual(detectedTerms), [detectedTerms]);

  if (!terms.length) return null;

  return (
    <View style={[styles.wrap, { backgroundColor: colors.tealBg, borderColor: colors.ok }]}>
      <Text style={[styles.title, { color: colors.tealInk }]}>术语小抄</Text>
      {terms.map((term) => (
        <View key={term.label} style={styles.item}>
          <Text style={[styles.zh, { color: colors.ink }]}>
            <Text style={styles.term}>{term.label}</Text>
            {` (${term.englishName})：${term.meaning}`}
          </Text>
          <Text style={[styles.en, { color: colors.muted }]}>EN: {term.meaningEn}</Text>
        </View>
      ))}
      {visual ? (
        <View style={[styles.visual, { borderTopColor: colors.ok }]}>
          <Text style={[styles.visualTitle, { color: colors.tealInk }]}>{visual.title}</Text>
          <Text style={[styles.visualTitleEn, { color: colors.muted }]}>{visual.titleEn}</Text>
          <MermaidView spec={visual.diagram} />
          <View style={styles.bullets}>
            {visual.bullets.map((item) => (
              <Text key={item} style={[styles.bullet, { color: colors.ink }]}>
                • {item}
              </Text>
            ))}
            {visual.bulletsEn.map((item) => (
              <Text key={item} style={[styles.bulletEn, { color: colors.muted }]}>
                EN: {item}
              </Text>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 12,
    marginBottom: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  title: {
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 8,
  },
  item: {
    marginTop: 8,
  },
  zh: {
    fontSize: 14,
    lineHeight: 21,
  },
  en: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 3,
  },
  term: {
    fontWeight: '800',
  },
  visual: {
    borderTopWidth: 1,
    marginTop: 12,
    paddingTop: 12,
  },
  visualTitle: {
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
  },
  visualTitleEn: {
    fontSize: 12.5,
    lineHeight: 18,
    marginTop: 2,
  },
  bullets: {
    marginTop: 10,
    gap: 5,
  },
  bullet: {
    fontSize: 13.5,
    lineHeight: 20,
  },
  bulletEn: {
    fontSize: 12.5,
    lineHeight: 18,
  },
});
