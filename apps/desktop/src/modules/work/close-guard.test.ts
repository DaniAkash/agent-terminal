import { describe, expect, mock, test } from 'bun:test'
import { handleCloseRequest } from './close-guard'

describe('window close guard', () => {
  test('Linux closes through an explicit app quit when work is idle', () => {
    const actions = {
      preventClose: mock(),
      confirmQuit: mock(),
      quit: mock(async () => {}),
    }
    handleCloseRequest(true, false, actions)
    expect(actions.preventClose).toHaveBeenCalledTimes(1)
    expect(actions.quit).toHaveBeenCalledTimes(1)
    expect(actions.confirmQuit).not.toHaveBeenCalled()
  })

  test('active work requests confirmation without quitting on either platform', () => {
    for (const linux of [true, false]) {
      const actions = {
        preventClose: mock(),
        confirmQuit: mock(),
        quit: mock(async () => {}),
      }
      handleCloseRequest(linux, true, actions)
      expect(actions.preventClose).toHaveBeenCalledTimes(1)
      expect(actions.confirmQuit).toHaveBeenCalledTimes(1)
      expect(actions.quit).not.toHaveBeenCalled()
    }
  })

  test('idle close on other platforms follows the native window behavior', () => {
    const actions = {
      preventClose: mock(),
      confirmQuit: mock(),
      quit: mock(async () => {}),
    }
    handleCloseRequest(false, false, actions)
    expect(actions.preventClose).not.toHaveBeenCalled()
    expect(actions.quit).not.toHaveBeenCalled()
  })

  test('a failed explicit quit leaves the window open and asks for confirmation', async () => {
    const actions = {
      preventClose: mock(),
      confirmQuit: mock(),
      quit: mock(async () => {
        throw new Error('exit failed')
      }),
    }
    handleCloseRequest(true, false, actions)
    await Promise.resolve()
    expect(actions.preventClose).toHaveBeenCalledTimes(1)
    expect(actions.confirmQuit).toHaveBeenCalledTimes(1)
  })
})
