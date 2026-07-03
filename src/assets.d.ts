// Raw-file assets bundled via metro.config.js assetExts (require() returns a module id).
declare module '*.txt' {
  const assetId: number;
  export default assetId;
}
declare module '*.html' {
  const assetId: number;
  export default assetId;
}
