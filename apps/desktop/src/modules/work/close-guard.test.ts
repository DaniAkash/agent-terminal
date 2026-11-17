import { describe, expect, mock, test } from 'bun:test'
import { handleCloseRequest } from './close-guard'

function actionSet() {
  return {
    preventClose: mock(),
    hide: mock(async () => {}),
    confirmQuit: mock(),
    quit: mock(async () => {}),
  }
}

describe('window close guard', () => {
  test('Linux closes through an explicit app quit when work is idle', () => {
    const actions = actionSet()
    handleCloseRequest(true, false, actions)
    expect(actions.preventClose).toHaveBeenCalledTimes(1)
    expect(actions.quit).toHaveBeenCalledTimes(1)
    expect(actions.confirmQuit).not.toHaveBeenCalled()
    expect(actions.hide).not.toHaveBeenCalled()
  })

  test('Linux active work requests confirmation without quitting', () => {
    const actions = actionSet()
    handleCloseRequest(true, true, actions)
    expect(actions.preventClose).toHaveBeenCalledTimes(1)
    expect(actions.confirmQuit).toHaveBeenCalledTimes(1)
    expect(actions.quit).not.toHaveBeenCalled()
    expect(actions.hide).not.toHaveBeenCalled()
  })

  test('other platforms hide instead of closing when work is idle', () => {
    const actions = actionSet()
    handleCloseRequest(false, false, actions)
    expect(actions.preventClose).toHaveBeenCalledTimes(1)
    expect(actions.hide).toHaveBeenCalledTimes(1)
    expect(actions.quit).not.toHaveBeenCalled()
    expect(actions.confirmQuit).not.toHaveBeenCalled()
  })

  test('other platforms hide without prompting even with active work', () => {
    // Hiding keeps every pty and agent running, so there is nothing at
    // risk to ask about. The prompt belongs to quit alone.
    const actions = actionSet()
    handleCloseRequest(false, true, actions)
    expect(actions.preventClose).toHaveBeenCalledTimes(1)
    expect(actions.hide).toHaveBeenCalledTimes(1)
    expect(actions.confirmQuit).not.toHaveBeenCalled()
    expect(actions.quit).not.toHaveBeenCalled()
  })

  test('a failed explicit quit leaves the window open and asks for confirmation', async () => {
    const actions = {
      ...actionSet(),
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
