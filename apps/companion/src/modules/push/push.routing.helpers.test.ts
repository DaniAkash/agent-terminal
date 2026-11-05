import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import type { DevicesState } from '@/modules/stores/$devices.types'
import { decideRoute, shouldPresentInForeground } from './push.routing.helpers'
import { canonical, signWith } from './push.sign.helpers'
import type { PushData } from './push.types'

const DEVICE_ID = 'e7a1c3f0-2b44-4d19-9c7e-5f0a8b61d204'
/** SHA-256 of the pairing token, exactly as the desktop stores it. */
const KEY = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'

/** Stands in for expo-crypto, which cannot be imported here: it pulls
 *  react-native into bun's module graph. Same algorithm, same hex. */
const digest = async (input: string) =>
  createHash('sha256').update(input).digest('hex')

const keyFor = async (id: string) => (id === DEVICE_ID ? KEY : null)

/**
 * The cross-language fixture. The Rust side asserts that
 * `build_message(...).data` serialises to exactly this, and that its
 * `sign()` produces this same signature. `data` is free-form JSON so
 * the typeshare drift check cannot see it; this pair is the only thing
 * keeping the two ends honest.
 */
const FIXTURE = {
  v: 1,
  deviceId: DEVICE_ID,
  projectId: 'proj_01HQ',
  tabId: 'tab_04',
  state: 'awaiting',
  agentId: 'claude-code',
  firedAt: 1762338240000,
  sig: 'e26e2e3eabfcdba29c4ccd0a344c037c',
} as const

function devices(over: Partial<DevicesState> = {}): DevicesState {
  return {
    loaded: true,
    byId: {
      [DEVICE_ID]: {
        token: 'raw',
        deviceId: DEVICE_ID,
        ips: [],
        port: 8443,
        fingerprint: 'fp',
        deviceHint: 'Mac',
        lastIp: null,
        lastPort: null,
      },
    },
    activeId: DEVICE_ID,
    ...over,
  }
}

const route = (raw: unknown, d = devices()) =>
  decideRoute(raw, d, keyFor, digest)

describe('the shared fixture', () => {
  test('the canonical string matches the Rust side byte for byte', () => {
    expect(canonical(FIXTURE)).toBe(
      'v1|e7a1c3f0-2b44-4d19-9c7e-5f0a8b61d204|proj_01HQ|tab_04|awaiting|1762338240000',
    )
  })

  test('the signature matches the one Rust produces', async () => {
    expect(await signWith(digest, KEY, canonical(FIXTURE))).toBe(FIXTURE.sig)
  })
})

describe('decideRoute', () => {
  test('routes a valid payload to that tab', async () => {
    expect(await route(FIXTURE)).toEqual({
      kind: 'route',
      deviceId: DEVICE_ID,
      href: '/tab/proj_01HQ/tab_04',
      switchDesktop: false,
    })
  })

  test('switches desktop when the push came from an inactive one', async () => {
    const d = await route(FIXTURE, devices({ activeId: 'some-other-desktop' }))
    expect(d).toMatchObject({ kind: 'route', switchDesktop: true })
  })

  // The cold-start race, and the one that only breaks in production: a
  // tap from a killed app resolves before SecureStore has hydrated.
  test('parks the route when devices have not hydrated yet', async () => {
    const d = await route(FIXTURE, devices({ loaded: false }))
    expect(d).toEqual({ kind: 'park', data: FIXTURE as unknown as PushData })
  })

  test('ignores a desktop this phone is no longer paired with', async () => {
    const d = await route(FIXTURE, devices({ byId: {} }))
    expect(d).toEqual({ kind: 'ignore', reason: 'unknown-device' })
  })

  test('reports a future payload version rather than calling it malformed', async () => {
    expect(await route({ ...FIXTURE, v: 2 })).toEqual({
      kind: 'ignore',
      reason: 'unsupported-version',
    })
  })

  test.each([[{}], [null], ['string'], [42]])(
    'ignores junk: %p',
    async (raw) => {
      expect(await route(raw)).toEqual({ kind: 'ignore', reason: 'malformed' })
    },
  )

  test('ignores a payload missing a routing field', async () => {
    const { tabId: _drop, ...rest } = FIXTURE
    expect(await route(rest)).toEqual({ kind: 'ignore', reason: 'malformed' })
  })

  test('ignores a payload with no signature at all', async () => {
    const { sig: _drop, ...rest } = FIXTURE
    expect(await route(rest)).toEqual({ kind: 'ignore', reason: 'malformed' })
  })

  test.each([
    ['projectId', 'proj_evil'],
    ['tabId', 'tab_99'],
    ['state', 'error'],
  ])('refuses a payload with %s tampered', async (field, value) => {
    expect(await route({ ...FIXTURE, [field]: value })).toEqual({
      kind: 'ignore',
      reason: 'bad-signature',
    })
  })

  test('refuses a signature forged with the wrong key', async () => {
    const forged = await signWith(digest, '0'.repeat(64), canonical(FIXTURE))
    expect(await route({ ...FIXTURE, sig: forged })).toEqual({
      kind: 'ignore',
      reason: 'bad-signature',
    })
  })
})

describe('shouldPresentInForeground', () => {
  const data = FIXTURE as unknown as PushData

  test('stays quiet when you are already looking at that tab', () => {
    expect(shouldPresentInForeground(data, DEVICE_ID, 'proj_01HQ:tab_04')).toBe(
      false,
    )
  })

  test('shows when you are on a different tab', () => {
    expect(shouldPresentInForeground(data, DEVICE_ID, 'proj_01HQ:tab_09')).toBe(
      true,
    )
  })

  test('shows when the same tab id belongs to a different desktop', () => {
    expect(
      shouldPresentInForeground(data, 'other-desktop', 'proj_01HQ:tab_04'),
    ).toBe(true)
  })

  test('shows when no tab is open', () => {
    expect(shouldPresentInForeground(data, DEVICE_ID, null)).toBe(true)
  })
})
