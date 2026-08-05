import { describe, expect, test } from 'bun:test'
import { connectErrorMessage, normaliseWebSocketUrl } from './connect.helpers'
import { connectSchema } from './connect.schemas'

describe('normaliseWebSocketUrl', () => {
  test('preserves ws:// and wss:// prefixes', () => {
    expect(normaliseWebSocketUrl('ws://192.168.1.42:47823/stream')).toBe(
      'ws://192.168.1.42:47823/stream',
    )
    expect(normaliseWebSocketUrl('wss://example.com/stream')).toBe(
      'wss://example.com/stream',
    )
  })

  test('prepends ws:// to a bare host:port', () => {
    expect(normaliseWebSocketUrl('192.168.1.42:47823')).toBe(
      'ws://192.168.1.42:47823',
    )
  })

  test('returns empty for empty input', () => {
    expect(normaliseWebSocketUrl('   ')).toBe('')
    expect(normaliseWebSocketUrl('')).toBe('')
  })
})

describe('connectSchema', () => {
  test('rejects empty URL with a specific message', () => {
    const result = connectSchema.safeParse({ url: '', token: 'x' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('WSS URL is required')
      expect(result.error.issues[0]?.path).toEqual(['url'])
    }
  })

  test('rejects whitespace-only token', () => {
    const result = connectSchema.safeParse({ url: 'ws://x', token: '   ' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Token is required')
      expect(result.error.issues[0]?.path).toEqual(['token'])
    }
  })

  test('normalises URL and trims token on success', () => {
    const result = connectSchema.safeParse({
      url: '192.168.1.1:47823',
      token: '  99be5462-d34a-49d6-9754-8c4ed9f2456f  ',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({
        url: 'ws://192.168.1.1:47823',
        token: '99be5462-d34a-49d6-9754-8c4ed9f2456f',
      })
    }
  })
})

describe('connectErrorMessage', () => {
  test('auth_failed surfaces the server-provided reason', () => {
    expect(connectErrorMessage('auth_failed', 'bad token')).toBe(
      'Auth failed, bad token',
    )
  })

  test('unreachable falls back to a generic message when no error', () => {
    expect(connectErrorMessage('unreachable', null)).toBe(
      'Server not reachable. Check the URL and your Wi-Fi.',
    )
  })

  test('unreachable includes the error reason when present', () => {
    expect(connectErrorMessage('unreachable', 'timeout')).toBe(
      'Server not reachable, timeout',
    )
  })

  test('returns null when nothing is wrong', () => {
    expect(connectErrorMessage('connected', null)).toBe(null)
    expect(connectErrorMessage('connecting', null)).toBe(null)
  })
})
