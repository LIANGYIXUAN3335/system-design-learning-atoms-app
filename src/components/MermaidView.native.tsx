import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { CodeBlock } from './ui';
import { useTheme } from '../theme';

/**
 * Offline Mermaid rendering for iOS/Android. Content stores the Mermaid spec;
 * the app renders it without network access by inlining the bundled Mermaid JS
 * into a local WebView shell.
 */

const VIEWER_DIR = 'mermaid-v2/';

let setupPromise: Promise<{ html: string; dirUri: string }> | null = null;

async function copyAssetTo(moduleRef: number, target: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(target);
  if (info.exists) return;
  const asset = Asset.fromModule(moduleRef);
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error('asset has no localUri');
  await FileSystem.copyAsync({ from: asset.localUri, to: target });
}

function inlineMermaid(shellHtml: string, mermaidJs: string) {
  const escapedJs = mermaidJs.replace(/<\/script/gi, '<\\/script');
  const html = shellHtml.replace('<script src="./mermaid.js"></script>', `<script>${escapedJs}</script>`);
  if (html === shellHtml) throw new Error('diagram shell is missing mermaid script tag');
  return html;
}

/** mermaid.min.js is ~3.4MB; anything below this is a truncated/corrupt copy */
const MIN_LIB_CHARS = 1_000_000;

function ensureViewer(): Promise<{ html: string; dirUri: string }> {
  if (!setupPromise) {
    setupPromise = (async () => {
      const dirUri = FileSystem.cacheDirectory + VIEWER_DIR;
      const mermaidUri = dirUri + 'mermaid.js';
      const shellUri = dirUri + 'index.html';
      await FileSystem.makeDirectoryAsync(dirUri, { intermediates: true }).catch(() => {});
      await copyAssetTo(require('../../assets/mermaid.min.txt'), mermaidUri);
      await copyAssetTo(require('../../assets/diagram.html'), shellUri);
      const [shellHtml, mermaidJs] = await Promise.all([
        FileSystem.readAsStringAsync(shellUri),
        FileSystem.readAsStringAsync(mermaidUri),
      ]);
      if (mermaidJs.length < MIN_LIB_CHARS) {
        // A copy interrupted mid-write used to pass the exists check forever.
        await FileSystem.deleteAsync(mermaidUri, { idempotent: true }).catch(() => {});
        throw new Error(`cached mermaid.js is truncated (${mermaidJs.length} chars) - reopen this card to re-copy`);
      }
      return { html: inlineMermaid(shellHtml, mermaidJs), dirUri };
    })();
    setupPromise.catch(() => {
      setupPromise = null; // allow retry on next mount
    });
  }
  return setupPromise;
}

export function MermaidView({ spec }: { spec: string }) {
  const { colors, isDark } = useTheme();
  const [viewer, setViewer] = useState<{ html: string; dirUri: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [height, setHeight] = useState(160);

  useEffect(() => {
    let alive = true;
    setFailed(null);
    ensureViewer()
      .then((v) => alive && setViewer(v))
      .catch((e) => alive && setFailed(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [spec, isDark]);

  const injected = useMemo(
    () => `window.__render(${JSON.stringify(spec)}, ${isDark ? 'true' : 'false'}); true;`,
    [spec, isDark],
  );

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
      }}
    >
      {viewer ? (
        <WebView
          key={`${spec}-${isDark}`}
          source={{ html: viewer.html, baseUrl: viewer.dirUri }}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          allowFileAccess
          allowFileAccessFromFileURLs
          allowingReadAccessToURL={viewer.dirUri}
          injectedJavaScript={injected}
          onMessage={(e) => {
            const data = e.nativeEvent.data;
            if (data.startsWith('ERR:')) setFailed(data.slice(4).trim() || 'unknown Mermaid render error');
            else {
              if (data === 'READY') return;
              const h = parseInt(data.startsWith('H:') ? data.slice(2) : data, 10);
              if (Number.isFinite(h) && h > 0) setHeight(Math.min(h + 8, 600));
            }
          }}
          onError={(e) => setFailed(e.nativeEvent.description || 'WebView failed to load diagram renderer')}
          scrollEnabled={false}
          style={{ height, backgroundColor: 'transparent' }}
        />
      ) : (
        <View style={{ height: 100, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.accent} />
        </View>
      )}
    </View>
  );
}
