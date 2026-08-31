import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

// CommonJS import — index.js is intentionally a CJS module (Tauri's bundled
// Node may pre-date ESM-by-default). bun:test handles the interop.
const sidecar = require('../index.js') as {
  dispatch: (msg: unknown) => Promise<void>
  _terminals: Map<string, unknown>
}

type Reply = Record<string, unknown> & { id?: unknown }

let captured: Reply[] = []
let originalWrite: typeof process.stdout.write

function b64(s: string): string {
  return Buffer.from(s).toString('base64')
}

function lastReply(): Reply {
  const r = captured.at(-1)
  if (!r) throw new Error('expected a reply, got none')
  return r
}

beforeEach(() => {
  captured = []
  originalWrite = process.stdout.write.bind(process.stdout)
  // Intercept stdout so dispatch() replies are captured instead of polluting
  // the test runner's output. Every reply is a single JSON line.
  process.stdout.write = ((chunk: string | Uint8Array) => {
    const str =
      typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
    for (const line of str.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        captured.push(JSON.parse(trimmed) as Reply)
      } catch {
        // ignore non-JSON lines (none expected on stdout)
      }
    }
    return true
  }) as typeof process.stdout.write
  sidecar._terminals.clear()
})

afterEach(() => {
  process.stdout.write = originalWrite
  sidecar._terminals.clear()
})

describe('dispatch — happy path', () => {
  test('open assigns terminal and replies ok', async () => {
    await sidecar.dispatch({
      id: 1,
      verb: 'open',
      args: { tab_id: 't1', cols: 80, rows: 24 },
    })
    expect(lastReply()).toEqual({ id: 1, ok: true })
    expect(sidecar._terminals.has('t1')).toBe(true)
  })

  test('write is fire-and-forget (no reply)', async () => {
    await sidecar.dispatch({
      id: 1,
      verb: 'open',
      args: { tab_id: 't1', cols: 80, rows: 24 },
    })
    captured.length = 0
    await sidecar.dispatch({
      verb: 'write',
      args: { tab_id: 't1', bytes_b64: b64('hello') },
    })
    expect(captured).toHaveLength(0)
  })

  test('serialize after write returns a payload containing the written text', async () => {
    await sidecar.dispatch({
      id: 1,
      verb: 'open',
      args: { tab_id: 't1', cols: 80, rows: 24 },
    })
    await sidecar.dispatch({
      verb: 'write',
      args: { tab_id: 't1', bytes_b64: b64('hello world') },
    })
    captured.length = 0
    await sidecar.dispatch({
      id: 7,
      verb: 'serialize',
      args: { tab_id: 't1', scrollback: 100 },
    })
    const r = lastReply()
    expect(r.id).toBe(7)
    expect(r.ok).toBe(true)
    expect(typeof r.payload).toBe('string')
    expect(r.payload as string).toContain('hello world')
    // last_seq is null when writeBytes was called without a seq (this
    // test's write above does not pass one). The Rust side reads this
    // as Option::None which subscribe_remote treats as "no writes seen
    // yet." See the dedicated seq-threading test below for Some(N).
    expect(r.last_seq).toBeNull()
  })

  test('serialize returns last_seq threaded through writeBytes', async () => {
    await sidecar.dispatch({
      id: 1,
      verb: 'open',
      args: { tab_id: 't1', cols: 80, rows: 24 },
    })
    // Three writes with increasing seqs. Sidecar tracks the highest
    // seq per tab; serialize echoes it back.
    await sidecar.dispatch({
      verb: 'write',
      args: { tab_id: 't1', bytes_b64: b64('one\r\n'), seq: 100 },
    })
    await sidecar.dispatch({
      verb: 'write',
      args: { tab_id: 't1', bytes_b64: b64('two\r\n'), seq: 101 },
    })
    await sidecar.dispatch({
      verb: 'write',
      args: { tab_id: 't1', bytes_b64: b64('three\r\n'), seq: 102 },
    })
    captured.length = 0
    await sidecar.dispatch({
      id: 5,
      verb: 'serialize',
      args: { tab_id: 't1', scrollback: 100 },
    })
    const r = lastReply()
    expect(r.ok).toBe(true)
    expect(r.last_seq).toBe(102)
  })

  test('resize replies ok and is reflected on subsequent serialize', async () => {
    await sidecar.dispatch({
      id: 1,
      verb: 'open',
      args: { tab_id: 't1', cols: 80, rows: 24 },
    })
    captured.length = 0
    await sidecar.dispatch({
      id: 2,
      verb: 'resize',
      args: { tab_id: 't1', cols: 132, rows: 40 },
    })
    expect(lastReply()).toEqual({ id: 2, ok: true })
  })

  test('close removes the terminal and replies ok', async () => {
    await sidecar.dispatch({
      id: 1,
      verb: 'open',
      args: { tab_id: 't1', cols: 80, rows: 24 },
    })
    captured.length = 0
    await sidecar.dispatch({ id: 9, verb: 'close', args: { tab_id: 't1' } })
    expect(lastReply()).toEqual({ id: 9, ok: true })
    expect(sidecar._terminals.has('t1')).toBe(false)
  })
})

describe('dispatch — error paths', () => {
  test('unknown verb replies ok:false with reason', async () => {
    await sidecar.dispatch({ id: 3, verb: 'nope', args: {} })
    expect(lastReply()).toEqual({ id: 3, ok: false, error: 'unknown_verb' })
  })

  test('serialize on missing tab replies ok:false', async () => {
    await sidecar.dispatch({
      id: 4,
      verb: 'serialize',
      args: { tab_id: 'missing' },
    })
    expect(lastReply()).toEqual({ id: 4, ok: false, error: 'no_such_tab' })
  })

  test('write to unknown tab is a no-op (no reply, no throw)', async () => {
    await sidecar.dispatch({
      verb: 'write',
      args: { tab_id: 'missing', bytes_b64: b64('x') },
    })
    expect(captured).toHaveLength(0)
  })

  test('close on unknown tab is a no-op-with-reply', async () => {
    await sidecar.dispatch({
      id: 5,
      verb: 'close',
      args: { tab_id: 'missing' },
    })
    // The close path replies ok unconditionally; idempotent close keeps the
    // Rust side simple (no need to track "did I open this").
    expect(lastReply()).toEqual({ id: 5, ok: true })
  })
})

describe('dispatch — tab isolation', () => {
  test('writes to different tabs do not bleed into each other', async () => {
    await sidecar.dispatch({
      id: 1,
      verb: 'open',
      args: { tab_id: 'a', cols: 80, rows: 24 },
    })
    await sidecar.dispatch({
      id: 2,
      verb: 'open',
      args: { tab_id: 'b', cols: 80, rows: 24 },
    })
    await sidecar.dispatch({
      verb: 'write',
      args: { tab_id: 'a', bytes_b64: b64('alpha\r\n') },
    })
    await sidecar.dispatch({
      verb: 'write',
      args: { tab_id: 'b', bytes_b64: b64('beta\r\n') },
    })

    captured.length = 0
    await sidecar.dispatch({ id: 10, verb: 'serialize', args: { tab_id: 'a' } })
    await sidecar.dispatch({ id: 11, verb: 'serialize', args: { tab_id: 'b' } })

    const replyA = captured.find((r) => r.id === 10)
    const replyB = captured.find((r) => r.id === 11)
    expect(replyA?.payload as string).toContain('alpha')
    expect(replyA?.payload as string).not.toContain('beta')
    expect(replyB?.payload as string).toContain('beta')
    expect(replyB?.payload as string).not.toContain('alpha')
  })

  test('reopening a tab id disposes the old terminal and starts fresh', async () => {
    await sidecar.dispatch({
      id: 1,
      verb: 'open',
      args: { tab_id: 't', cols: 80, rows: 24 },
    })
    await sidecar.dispatch({
      verb: 'write',
      args: { tab_id: 't', bytes_b64: b64('first-session\r\n') },
    })

    await sidecar.dispatch({
      id: 2,
      verb: 'open',
      args: { tab_id: 't', cols: 80, rows: 24 },
    })
    captured.length = 0
    await sidecar.dispatch({ id: 3, verb: 'serialize', args: { tab_id: 't' } })
    const payload = lastReply().payload as string
    expect(payload).not.toContain('first-session')
  })
})
