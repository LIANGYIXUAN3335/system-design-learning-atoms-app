import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { CodeBlock } from './ui';
import { useTheme } from '../theme';

/**
 * Offline Mermaid rendering for iOS/Android. Content stores the Mermaid spec;
 * the app renders it without network access by inlining the bundled Mermaid JS
 * into a local WebView shell. Tapping the diagram opens a full-screen,
 * pinch-to-zoom viewer so dense flowcharts stay readable on a phone.
 */

const VIEWER_DIR = 'mermaid-v2/';

let setupPromise: Promise<{ html: string; zoomHtml: string; dirUri: string }> | null = null;

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
  // Use a REPLACER FUNCTION, not a string. A string replacement treats `$&`, `$\``,
  // `$'`, `$$` as special patterns; the 3.4MB minified lib contains ~39 of them, and
  // an expanded `$&` splices an unescaped </script> into the script, closing it early
  // and dumping the rest of the library into the page as visible text. A function
  // replacer inserts the string verbatim, so no `$`-sequence is ever interpreted.
  const html = shellHtml.replace('<script src="./mermaid.js"></script>', () => `<script>${escapedJs}</script>`);
  if (html === shellHtml) throw new Error('diagram shell is missing mermaid script tag');
  return html;
}

/** A zoom-enabled clone of the viewer: unlock the viewport so the full-screen
 *  WebView can pinch-zoom. The inline preview keeps the locked shell + no scroll. */
function unlockZoom(html: string): string {
  return html.replace('maximum-scale=1', () => 'maximum-scale=8, user-scalable=yes');
}

/** Reflow left-right flowcharts to top-down. A wide LR graph gets scaled down to
 *  the phone's width until the node labels are unreadably small; stacking the
 *  nodes vertically (client → gateway → app → service) keeps the text large.
 *  Only the flowchart/graph direction is touched — sequence / ER / state / class
 *  / gantt diagrams have no LR/TD axis and are left untouched. `$1`/`$2` here are
 *  intended capture-group backreferences (unlike inlineMermaid, where `$` must be
 *  literal). */
function toVertical(spec: string): string {
  return spec
    .replace(/^(\s*(?:flowchart|graph)\s+)(?:LR|RL|BT)\b/im, '$1TD')
    .replace(/(^|\n)(\s*direction\s+)(?:LR|RL|BT)\b/gim, '$1$2TB');
}

/** mermaid.min.js is ~3.4MB; anything below this is a truncated/corrupt copy */
const MIN_LIB_CHARS = 1_000_000;

function ensureViewer(): Promise<{ html: string; zoomHtml: string; dirUri: string }> {
  if (!setupPromise) {
    setupPromise = (async () => {
      const dirUri = FileSystem.cacheDirectory + VIEWER_DIR;
      const mermaidUri = dirUri + 'mermaid.js';
      const shellUri = dirUri + 'index.html';
      await FileSystem.makeDirectoryAsync(dirUri, { intermediates: true }).catch(() => {});
      await copyAssetTo(require('../../assets/mermaid.min.txt'), mermaidUri);
      await copyAssetTo(require('../../assets/diagram.html'), shellUri);
      const [shellHtml, firstJs] = await Promise.all([
        FileSystem.readAsStringAsync(shellUri),
        FileSystem.readAsStringAsync(mermaidUri),
      ]);
      let mermaidJs = firstJs;
      if (mermaidJs.length < MIN_LIB_CHARS) {
        // A copy interrupted mid-write used to pass the exists check forever.
        await FileSystem.deleteAsync(mermaidUri, { idempotent: true }).catch(() => {});
        await copyAssetTo(require('../../assets/mermaid.min.txt'), mermaidUri);
        mermaidJs = await FileSystem.readAsStringAsync(mermaidUri);
        if (mermaidJs.length < MIN_LIB_CHARS) {
          throw new Error(`cached mermaid.js is truncated (${mermaidJs.length} chars)`);
        }
      }
      const html = inlineMermaid(shellHtml, mermaidJs);
      return { html, zoomHtml: unlockZoom(html), dirUri };
    })();
    setupPromise.catch(() => {
      setupPromise = null; // allow retry on next mount
    });
  }
  return setupPromise;
}

export function MermaidView({ spec }: { spec: string }) {
  const { colors, isDark } = useTheme();
  const webViewRef = useRef<React.ElementRef<typeof WebView> | null>(null);
  const zoomViewRef = useRef<React.ElementRef<typeof WebView> | null>(null);
  const [viewer, setViewer] = useState<{ html: string; zoomHtml: string; dirUri: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [height, setHeight] = useState(160);
  const [zoomOpen, setZoomOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(null);
    setHeight(160);
    ensureViewer()
      .then((v) => alive && setViewer(v))
      .catch((e) => alive && setFailed(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [spec, isDark]);

  const verticalSpec = useMemo(() => toVertical(spec), [spec]);
  const injected = useMemo(
    () => `window.__render(${JSON.stringify(verticalSpec)}, ${isDark ? 'true' : 'false'}); true;`,
    [verticalSpec, isDark],
  );
  const renderWhenReady = useCallback(() => {
    webViewRef.current?.injectJavaScript(injected);
  }, [injected]);
  const renderZoomWhenReady = useCallback(() => {
    zoomViewRef.current?.injectJavaScript(injected);
  }, [injected]);

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
        <>
          <WebView
            ref={webViewRef}
            key={`${spec}-${isDark}`}
            source={{ html: viewer.html, baseUrl: viewer.dirUri }}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            allowFileAccess
            allowFileAccessFromFileURLs
            allowingReadAccessToURL={viewer.dirUri}
            onMessage={(e) => {
              const data = e.nativeEvent.data;
              if (data.startsWith('ERR:')) setFailed(data.slice(4).trim() || 'unknown Mermaid render error');
              else {
                if (data === 'READY') {
                  renderWhenReady();
                  return;
                }
                const h = parseInt(data.startsWith('H:') ? data.slice(2) : data, 10);
                if (Number.isFinite(h) && h > 0) setHeight(Math.min(h + 8, 600));
              }
            }}
            onError={(e) => setFailed(e.nativeEvent.description || 'WebView failed to load diagram renderer')}
            scrollEnabled={false}
            style={{ height, backgroundColor: 'transparent' }}
          />
          {/* Tap anywhere on the diagram to open the full-screen zoom viewer.
              A transparent overlay grabs the tap so the (non-interactive) preview
              WebView never swallows it. */}
          <Pressable
            onPress={() => setZoomOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="放大查看流程图"
            style={StyleSheet.absoluteFill}
          >
            <View style={[styles.zoomHint, { backgroundColor: isDark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.85)', borderColor: colors.line }]}>
              <Text style={{ fontSize: 11, color: colors.muted }}>🔍 点击放大</Text>
            </View>
          </Pressable>
        </>
      ) : (
        <View style={{ height: 100, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.accent} />
        </View>
      )}

      <Modal
        visible={zoomOpen}
        animationType="fade"
        onRequestClose={() => setZoomOpen(false)}
        statusBarTranslucent
      >
        <View style={{ flex: 1, backgroundColor: isDark ? '#0b0b0d' : '#ffffff' }}>
          <View style={[styles.zoomHeader, { borderBottomColor: colors.line }]}>
            <Pressable
              onPress={() => setZoomOpen(false)}
              hitSlop={12}
              style={({ pressed }) => [
                styles.closeBtn,
                { borderColor: pressed ? colors.accent : colors.line },
              ]}
            >
              <Text style={{ color: colors.ink, fontSize: 15, fontWeight: '600' }}>✕ 关闭</Text>
            </Pressable>
            <Text style={{ color: colors.muted, fontSize: 12 }}>双指缩放 · 拖动查看</Text>
          </View>
          {viewer ? (
            <WebView
              ref={zoomViewRef}
              key={`zoom-${spec}-${isDark}`}
              source={{ html: viewer.zoomHtml, baseUrl: viewer.dirUri }}
              originWhitelist={['*']}
              javaScriptEnabled
              domStorageEnabled
              allowFileAccess
              allowFileAccessFromFileURLs
              allowingReadAccessToURL={viewer.dirUri}
              scrollEnabled
              scalesPageToFit
              onMessage={(e) => {
                const data = e.nativeEvent.data;
                if (data === 'READY') renderZoomWhenReady();
              }}
              style={{ flex: 1, backgroundColor: 'transparent' }}
            />
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  zoomHint: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  zoomHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 44,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  closeBtn: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
});
