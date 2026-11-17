import { describe, expect, test } from 'bun:test'
import {
  clampTerminalScale,
  DOUBLE_TAP_MS,
  FULL_TERMINAL_SCALE,
  fitWidthScale,
  gridApplication,
  gridSizeForContainer,
  isPinchGesture,
  MAX_TERMINAL_SCALE,
  MIN_TERMINAL_SCALE,
  movedBeyondTapSlop,
  pinchScale,
  TAP_SLOP_PX,
  touchEndOutcome,
  touchPoint,
} from './terminal-grid.helpers'

describe('fitWidthScale', () => {
  test('spans the container with the whole grid', () => {
    // 80 cols at 7px is a 560px grid; a 280px container shows it at half.
    expect(fitWidthScale(280, 80, 7)).toBe(0.5)
  })

  test('stops at the legible floor rather than shrinking to fit', () => {
    // A desktop-width grid on a phone: 180 cols at 7px is 1260px, which
    // would fit a 390px screen at 0.31. Panning beats an unreadable grid.
    expect(fitWidthScale(390, 180, 7)).toBe(MIN_TERMINAL_SCALE)
  })

  test('never magnifies a grid narrower than the container', () => {
    expect(fitWidthScale(800, 40, 7)).toBe(FULL_TERMINAL_SCALE)
  })

  test('falls back to 1:1 when the metrics are not measurable yet', () => {
    expect(fitWidthScale(390, 0, 7)).toBe(FULL_TERMINAL_SCALE)
    expect(fitWidthScale(390, 80, 0)).toBe(FULL_TERMINAL_SCALE)
    expect(fitWidthScale(0, 80, 7)).toBe(FULL_TERMINAL_SCALE)
    expect(fitWidthScale(Number.NaN, 80, 7)).toBe(FULL_TERMINAL_SCALE)
  })
})

describe('clampTerminalScale', () => {
  test('holds the scale between the legible floor and the ceiling', () => {
    expect(clampTerminalScale(0.1)).toBe(MIN_TERMINAL_SCALE)
    expect(clampTerminalScale(9)).toBe(MAX_TERMINAL_SCALE)
    expect(clampTerminalScale(0.75)).toBe(0.75)
  })

  test('answers 1:1 for a value that is not a number', () => {
    expect(clampTerminalScale(Number.NaN)).toBe(FULL_TERMINAL_SCALE)
    expect(clampTerminalScale(Number.POSITIVE_INFINITY)).toBe(
      FULL_TERMINAL_SCALE,
    )
  })
})

describe('pinchScale', () => {
  test('scales with the ratio the fingers moved through', () => {
    expect(pinchScale(0.5, 100, 200)).toBe(1)
    expect(pinchScale(1, 200, 100)).toBe(0.5)
  })

  test('clamps rather than running away on a long pinch', () => {
    expect(pinchScale(1, 100, 1000)).toBe(MAX_TERMINAL_SCALE)
    expect(pinchScale(1, 1000, 10)).toBe(MIN_TERMINAL_SCALE)
  })

  test('keeps the starting scale when a distance is unusable', () => {
    expect(pinchScale(0.8, 0, 120)).toBe(0.8)
    expect(pinchScale(0.8, 120, 0)).toBe(0.8)
  })
})

describe('gridSizeForContainer', () => {
  test('floors to whole cells', () => {
    expect(gridSizeForContainer(390, 700, 7, 14)).toEqual({
      cols: 55,
      rows: 50,
    })
  })

  test('never declares a zero-cell viewport', () => {
    expect(gridSizeForContainer(3, 3, 7, 14)).toEqual({ cols: 1, rows: 1 })
  })

  test('declares nothing until the cell has been measured', () => {
    expect(gridSizeForContainer(390, 700, 0, 14)).toBeNull()
    expect(gridSizeForContainer(390, 700, 7, 0)).toBeNull()
    expect(gridSizeForContainer(0, 700, 7, 14)).toBeNull()
  })
})

describe('gridApplication', () => {
  test('resizes when the desktop sends a different grid', () => {
    expect(
      gridApplication({ cols: 120, rows: 40 }, { cols: 80, rows: 24 }),
    ).toBe('resize')
    expect(
      gridApplication({ cols: 80, rows: 40 }, { cols: 80, rows: 24 }),
    ).toBe('resize')
  })

  test('relayouts without resizing when the grid already matches', () => {
    expect(
      gridApplication({ cols: 80, rows: 24 }, { cols: 80, rows: 24 }),
    ).toBe('relayout')
  })

  test('ignores a grid with no cells in it', () => {
    expect(gridApplication({ cols: 0, rows: 24 }, { cols: 80, rows: 24 })).toBe(
      'ignore',
    )
    expect(gridApplication({ cols: 80, rows: 0 }, { cols: 80, rows: 24 })).toBe(
      'ignore',
    )
    expect(
      gridApplication({ cols: Number.NaN, rows: 24 }, { cols: 80, rows: 24 }),
    ).toBe('ignore')
  })
})

describe('touchPoint', () => {
  test('reads the touch position', () => {
    expect(touchPoint({ clientX: 12, clientY: 34 })).toEqual({ x: 12, y: 34 })
  })

  test('answers the origin when there is no touch', () => {
    expect(touchPoint(null)).toEqual({ x: 0, y: 0 })
    expect(touchPoint(undefined)).toEqual({ x: 0, y: 0 })
  })
})

describe('isPinchGesture', () => {
  test('needs two fingers and a measured starting spread', () => {
    expect(isPinchGesture(2, 120)).toBe(true)
    expect(isPinchGesture(2, 0)).toBe(false)
    expect(isPinchGesture(1, 120)).toBe(false)
    expect(isPinchGesture(3, 120)).toBe(false)
  })
})

describe('movedBeyondTapSlop', () => {
  test('holds a finger that barely moved inside the tap', () => {
    const from = { x: 100, y: 100 }
    expect(movedBeyondTapSlop(from, { x: 100, y: 100 })).toBe(false)
    expect(
      movedBeyondTapSlop(from, { x: 100 + TAP_SLOP_PX, y: 100 + TAP_SLOP_PX }),
    ).toBe(false)
  })

  test('calls a drag on either axis once past the slop', () => {
    const from = { x: 100, y: 100 }
    expect(movedBeyondTapSlop(from, { x: 100 + TAP_SLOP_PX + 1, y: 100 })).toBe(
      true,
    )
    expect(movedBeyondTapSlop(from, { x: 100, y: 100 - TAP_SLOP_PX - 1 })).toBe(
      true,
    )
  })
})

describe('touchEndOutcome', () => {
  const resting = {
    remainingTouches: 0,
    pinchStartDistance: 0,
    tapMoved: false,
    sinceLastTap: 5_000,
  }

  test('waits while a finger is still down', () => {
    expect(touchEndOutcome({ ...resting, remainingTouches: 1 })).toBe('ignore')
  })

  test('ends a pinch rather than reading it as a tap', () => {
    expect(
      touchEndOutcome({
        ...resting,
        pinchStartDistance: 120,
        sinceLastTap: 10,
      }),
    ).toBe('end-pinch')
  })

  test('disarms the double tap after a drag', () => {
    expect(
      touchEndOutcome({ ...resting, tapMoved: true, sinceLastTap: 10 }),
    ).toBe('reset-tap')
  })

  test('toggles zoom on a second still tap inside the window', () => {
    expect(
      touchEndOutcome({ ...resting, sinceLastTap: DOUBLE_TAP_MS - 1 }),
    ).toBe('toggle-zoom')
  })

  test('arms the window on a lone tap', () => {
    expect(touchEndOutcome(resting)).toBe('arm-tap')
    expect(touchEndOutcome({ ...resting, sinceLastTap: DOUBLE_TAP_MS })).toBe(
      'arm-tap',
    )
  })
})
