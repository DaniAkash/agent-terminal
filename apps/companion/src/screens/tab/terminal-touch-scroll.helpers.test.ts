import { describe, expect, test } from 'bun:test'
import { touchScrollStep } from './terminal-touch-scroll.helpers'

const CELL = 20

describe('touchScrollStep', () => {
  test('dragging down reveals earlier output, which is a negative scroll', () => {
    expect(touchScrollStep(60, CELL, 0).lines).toBe(-3)
  })

  test('dragging up returns toward the prompt', () => {
    expect(touchScrollStep(-60, CELL, 0).lines).toBe(3)
  })

  test('movement smaller than a row scrolls nothing but is not lost', () => {
    const step = touchScrollStep(8, CELL, 0)
    expect(step.lines).toBe(0)
    expect(step.carry).toBeCloseTo(0.4)
  })

  test('carried remainder accumulates until it crosses a row', () => {
    // Three 8px nudges are 1.2 rows in total. Truncating each one on its
    // own would scroll nothing at all, which is the bug this guards.
    let carry = 0
    let scrolled = 0
    for (let i = 0; i < 3; i++) {
      const step = touchScrollStep(8, CELL, carry)
      carry = step.carry
      scrolled += step.lines
    }
    expect(scrolled).toBe(-1)
    expect(carry).toBeCloseTo(0.2)
  })

  test('the leftover keeps the direction of the drag', () => {
    expect(touchScrollStep(-8, CELL, 0).carry).toBeCloseTo(-0.4)
  })

  test('an unlaid-out terminal swallows the movement rather than dividing by zero', () => {
    expect(touchScrollStep(100, 0, 0)).toEqual({ lines: 0, carry: 0 })
    expect(touchScrollStep(100, Number.NaN, 0.25)).toEqual({
      lines: 0,
      carry: 0.25,
    })
  })

  test('a fling is reported in full rather than clamped', () => {
    expect(touchScrollStep(1000, CELL, 0).lines).toBe(-50)
  })
})
