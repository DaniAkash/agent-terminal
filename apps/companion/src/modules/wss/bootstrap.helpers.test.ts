import { describe, expect, test } from 'bun:test'
import { decideDeviceAction } from './bootstrap.helpers'

describe('decideDeviceAction', () => {
  test('has nothing to do when no desktop is paired', () => {
    expect(decideDeviceAction(null, null, 'disconnected')).toBe('skip')
    expect(decideDeviceAction('d1', null, 'connected')).toBe('skip')
  })

  test('connects on a cold start, where nothing is being driven yet', () => {
    expect(decideDeviceAction(null, 'd1', 'disconnected')).toBe('connect')
  })

  test('leaves a live socket for the same desktop alone', () => {
    // The record is rewritten whenever the ladder learns a working endpoint,
    // so this fires routinely and must not restack autoConnect.
    expect(decideDeviceAction('d1', 'd1', 'connected')).toBe('skip')
    expect(decideDeviceAction('d1', 'd1', 'connecting')).toBe('skip')
  })

  test('retries the same desktop once the socket is down or gave up', () => {
    expect(decideDeviceAction('d1', 'd1', 'disconnected')).toBe('connect')
    expect(decideDeviceAction('d1', 'd1', 'unreachable')).toBe('connect')
  })

  test('switches when the active desktop is not the one being driven', () => {
    // The bug this guards: skipping on `connected` left the socket talking to
    // the previous desktop while the UI showed the newly selected one.
    expect(decideDeviceAction('d1', 'd2', 'connected')).toBe('switch')
    expect(decideDeviceAction('d1', 'd2', 'connecting')).toBe('switch')
  })

  test('still switches when the old socket had already dropped', () => {
    // disconnect() on a dead socket is harmless, and taking the same path
    // keeps the timers and stale tab subscriptions from the old desktop out.
    expect(decideDeviceAction('d1', 'd2', 'unreachable')).toBe('switch')
    expect(decideDeviceAction('d1', 'd2', 'disconnected')).toBe('switch')
  })

  test('pairing a second desktop while connected moves the socket over', () => {
    expect(decideDeviceAction('d1', 'd2', 'connected')).not.toBe('skip')
  })
})
