import { describe, expect, test } from 'bun:test'
import { bootFailureMessage } from './terminal-boot-error.helpers'

describe('bootFailureMessage', () => {
  test('uses the message of a thrown Error', () => {
    expect(bootFailureMessage(new Error('fetching wasm returned 404'))).toBe(
      'fetching wasm returned 404',
    )
  })

  test('passes a thrown string through', () => {
    expect(bootFailureMessage('boom')).toBe('boom')
  })

  test('falls back for a value that carries no message', () => {
    expect(bootFailureMessage({ nope: true })).toBe('Unknown error.')
    expect(bootFailureMessage(undefined)).toBe('Unknown error.')
  })
})
