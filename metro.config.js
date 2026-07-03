const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// txt/html: the Mermaid lib + diagram viewer shell, loaded into a WebView at
// runtime (fully offline diagram rendering). wasm: expo-sqlite's web backend.
for (const ext of ['txt', 'html', 'wasm']) {
  if (!config.resolver.assetExts.includes(ext)) config.resolver.assetExts.push(ext);
}

module.exports = config;
