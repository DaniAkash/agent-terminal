import { describe, expect, test } from 'bun:test'
import { assetUrl } from './ghostty-wasm.helpers'

describe('assetUrl', () => {
  test('passes a plain URL string through', () => {
    expect(assetUrl('/assets/ghostty-vt.wasm')).toBe('/assets/ghostty-vt.wasm')
  })

  test('reads uri off an asset record', () => {
    expect(assetUrl({ uri: 'http://localhost:8081/ghostty-vt.wasm' })).toBe(
      'http://localhost:8081/ghostty-vt.wasm',
    )
  })

  // A resolver failure otherwise surfaces as WebAssembly refusing bytes
  // that do not start with \0asm, which says nothing about the cause.
  test('throws when the asset resolved to neither shape', () => {
    expect(() => assetUrl(undefined)).toThrow(/assetExts/)
    expect(() => assetUrl({})).toThrow(/assetExts/)
    expect(() => assetUrl(42)).toThrow(/assetExts/)
  })
})
