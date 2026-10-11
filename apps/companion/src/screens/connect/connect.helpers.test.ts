import { describe, expect, test } from 'bun:test'
import { connectErrorMessage } from './connect.helpers'
import { connectSchema } from './connect.schemas'

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
    const result = connectSchema.safeParse({
      url: 'wss://host:1/stream',
      token: '   ',
      fingerprint:
        '03:0A:11:18:1F:26:2D:34:3B:42:49:50:57:5E:65:6C:73:7A:81:88:8F:96:9D:A4:AB:B2:B9:C0:C7:CE:D5:DC',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Token is required')
      expect(result.error.issues[0]?.path).toEqual(['token'])
    }
  })

  test('normalises URL, token and fingerprint on success', () => {
    const result = connectSchema.safeParse({
      url: '192.168.1.1:47823',
      token: '  00000000-0000-4000-8000-000000000000  ',
      fingerprint:
        '  03:0a:11:18:1f:26:2d:34:3b:42:49:50:57:5e:65:6c:73:7a:81:88:8f:96:9d:a4:ab:b2:b9:c0:c7:ce:d5:dc  ',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({
        url: 'wss://192.168.1.1:47823/stream',
        token: '00000000-0000-4000-8000-000000000000',
        fingerprint:
          '03:0A:11:18:1F:26:2D:34:3B:42:49:50:57:5E:65:6C:73:7A:81:88:8F:96:9D:A4:AB:B2:B9:C0:C7:CE:D5:DC',
      })
    }
  })

  test('rejects a fingerprint that is not 32 hex pairs', () => {
    const result = connectSchema.safeParse({
      url: '192.168.1.1:47823',
      token: 'tok',
      fingerprint: 'AB:CD:EF',
    })
    expect(result.success).toBe(false)
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
