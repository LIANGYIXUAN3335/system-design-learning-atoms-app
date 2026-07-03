import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { CodeBlock } from './ui';
import { useTheme } from '../theme';

/**
 * Web-safe Mermaid renderer. Some Expo web setups do not consistently resolve
 * MermaidView.web.tsx, so the base file must avoid native-only modules.
 * iOS/Android use MermaidView.native.tsx.
 */

type MermaidModule = typeof import('mermaid')['default'];

let mermaidPromise: Promise<MermaidModule> | null = null;
function loadMermaid(): Promise<MermaidModule> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => m.default);
    mermaidPromise.catch(() => {
      mermaidPromise = null; // allow retry on next mount
    });
  }
  return mermaidPromise;
}

let renderSeq = 0;

export function MermaidView({ spec }: { spec: string }) {
  const { colors, isDark } = useTheme();
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    setSvg(null);
    setFailed(null);
    (async () => {
      const id = `atoms-mmd-${++renderSeq}`;
      try {
        const mermaid = await loadMermaid();
        mermaid.initialize({
          startOnLoad: false,
          theme: isDark ? 'dark' : 'neutral',
          securityLevel: 'loose',
          fontFamily: '-apple-system, "PingFang SC", sans-serif',
        });
        const out = await mermaid.render(id, spec);
        if (alive) setSvg(out.svg);
      } catch (e) {
        // mermaid v11 leaves an error node in <body> when render throws.
        document.getElementById(`d${id}`)?.remove();
        document.getElementById(id)?.remove();
        const rawMessage = e instanceof Error ? e.message : String(e);
        const message = rawMessage.trim() || Object.prototype.toString.call(e);
        console.warn(`Mermaid render failed: ${message}\n${spec}`);
        if (alive) setFailed(message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [spec, isDark]);

  useEffect(() => {
    if (hostRef.current && svg) hostRef.current.innerHTML = svg;
  }, [svg]);

  if (failed) {
    const reason = failed.split('\n')[0]?.trim();
    const label = reason ? `图 diagram · 渲染不可用：${reason}` : '图 diagram · 渲染不可用，显示原始 spec';
    return <CodeBlock code={spec} label={label} />;
  }

  return (
    <View
      style={{
        marginTop: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.line,
        overflow: 'hidden',
        backgroundColor: isDark ? colors.card : '#ffffff',
        minHeight: 60,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {svg ? (
        <div
          ref={hostRef}
          style={{ width: '100%', display: 'flex', justifyContent: 'center', padding: '6px 4px', overflowX: 'auto' }}
        />
      ) : (
        <View style={{ height: 100, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.accent} />
        </View>
      )}
    </View>
  );
}
