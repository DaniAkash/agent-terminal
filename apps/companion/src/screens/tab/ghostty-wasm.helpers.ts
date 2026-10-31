/**
 * The URL the libghostty binary can be fetched from inside the DOM
 * component's WebView.
 *
 * `GhosttyCore.load()` defaults to `new URL('../wasm/ghostty-vt.wasm',
 * import.meta.url)`, which Vite understands and Metro does not, so the
 * caller imports the binary as a Metro asset and resolves it here.
 *
 * Metro hands an asset back as a URL string from a web bundle, which is
 * what a DOM component compiles to, and as a record carrying `uri` when
 * the native asset registry is in play. Both reach this code path.
 *
 * The asset import lives at the call site rather than in this module so
 * the resolver can be imported, and tested, outside a Metro bundle.
 */
export function assetUrl(asset: unknown): string {
  if (typeof asset === 'string') return asset
  const uri = (asset as { uri?: unknown } | null)?.uri
  if (typeof uri === 'string') return uri
  throw new Error(
    'ghostty-vt.wasm did not resolve to a URL; check that metro.config.js lists wasm in assetExts',
  )
}
