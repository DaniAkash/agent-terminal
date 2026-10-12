import { describe, expect, it } from 'bun:test'
import { planDevicesMigration } from './$devices.migrate.helpers'

describe('planDevicesMigration', () => {
  const v1 = JSON.stringify({
    token: 'tok',
    deviceId: 'dev-1',
    ips: ['10.0.0.2'],
    port: 8900,
    fingerprint: 'ff',
    deviceHint: 'Lancer',
    lastIp: null,
    lastPort: null,
  })

  it('does nothing on a fresh or already migrated install', () => {
    expect(planDevicesMigration(null)).toEqual({ kind: 'none' })
  })

  it('carries a valid record over verbatim, keyed by its device id', () => {
    const plan = planDevicesMigration(v1)
    expect(plan).toEqual({ kind: 'migrate', deviceId: 'dev-1', record: v1 })
  })

  it('drops an unparseable blob instead of migrating half a record', () => {
    expect(planDevicesMigration('{not json')).toEqual({ kind: 'drop' })
  })

  it('drops a blob that parses but fails the shape guard', () => {
    expect(planDevicesMigration('{"token":"t"}')).toEqual({ kind: 'drop' })
  })
})
