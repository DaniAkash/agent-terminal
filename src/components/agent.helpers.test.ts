import { describe, expect, test } from 'bun:test'
import type { TabMeta } from '@/modules/stores/$tabMeta'
import {
  hasDangerFlag,
  parseModelFlag,
  shouldShowDangerBadge,
} from './agent.helpers'

describe('hasDangerFlag', () => {
  test('detects claude --dangerously-skip-permissions', () => {
    expect(hasDangerFlag('claude --dangerously-skip-permissions')).toBe(true)
  })

  test('detects codex --yolo', () => {
    expect(hasDangerFlag('codex --yolo')).toBe(true)
  })

  test('returns false for a plain agent invocation', () => {
    expect(hasDangerFlag('claude')).toBe(false)
    expect(hasDangerFlag('codex --sandbox')).toBe(false)
  })

  test('returns false for undefined', () => {
    expect(hasDangerFlag(undefined)).toBe(false)
  })
})

describe('parseModelFlag', () => {
  test('extracts the model name after --model', () => {
    expect(parseModelFlag('claude --model claude-opus-4-5')).toBe(
      'claude-opus-4-5',
    )
  })

  test('returns null when the flag is missing', () => {
    expect(parseModelFlag('claude')).toBeNull()
  })

  test('returns null for undefined', () => {
    expect(parseModelFlag(undefined)).toBeNull()
  })
})

describe('shouldShowDangerBadge', () => {
  const agentDanger: TabMeta = {
    type: 'agent',
    agentId: 'claude-code',
    agentCmd: 'claude --dangerously-skip-permissions',
  }
  const agentSafe: TabMeta = {
    type: 'agent',
    agentId: 'claude-code',
    agentCmd: 'claude',
  }
  const shellTab: TabMeta = {
    type: 'shell',
    status: 'running',
  }

  test('true when opted in AND agent AND has flag', () => {
    expect(shouldShowDangerBadge(agentDanger, true)).toBe(true)
  })

  test('false when surface did not opt in, even for a YOLO agent', () => {
    expect(shouldShowDangerBadge(agentDanger, false)).toBe(false)
  })

  test('false for a shell tab, even with showDanger=true', () => {
    expect(shouldShowDangerBadge(shellTab, true)).toBe(false)
  })

  test('false for an agent tab without a full-permissions flag', () => {
    expect(shouldShowDangerBadge(agentSafe, true)).toBe(false)
  })

  test('false when meta is undefined (missing / new tab)', () => {
    expect(shouldShowDangerBadge(undefined, true)).toBe(false)
  })
})
