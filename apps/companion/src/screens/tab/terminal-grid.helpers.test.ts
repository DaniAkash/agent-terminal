import { describe, expect, test } from 'bun:test'
import {
  clampTerminalScale,
  FULL_TERMINAL_SCALE,
  fitWidthScale,
  gridSizeForContainer,
  MAX_TERMINAL_SCALE,
  MIN_TERMINAL_SCALE,
  pinchScale,
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
