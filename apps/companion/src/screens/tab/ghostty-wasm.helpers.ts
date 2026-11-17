/**
 * The URL the libghostty binary can be fetched from inside the DOM
 * component's WebView.
 *
 * `GhosttyCore.load()` defaults to `new URL('../wasm/ghostty-vt.wasm',
 * import.meta.url)`, which Vite understands and Metro does not, so the
 * caller imports the binary and resolves it here.
 *
 * The import now arrives as a `data:` URI string, because the asset
 * pipeline never reached a DOM component's bundle and release builds
 * shipped without the binary at all. The record carrying `uri` is still
 * accepted: that is the shape Metro's native asset registry returns, and
 * a caller outside the DOM bundle would still see it.
 *
 * The import lives at the call site rather than in this module so the
 * resolver can be imported, and tested, outside a Metro bundle.
 */
export function assetUrl(asset: unknown): string {
  if (typeof asset === 'string') return asset
  const uri = (asset as { uri?: unknown } | null)?.uri
  if (typeof uri === 'string') return uri
  throw new Error(
    'ghostty-vt.wasm did not resolve to a URL; check that metro.config.js routes wasm through the inlining transformer',
  )
}
