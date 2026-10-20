import { describe, expect, test } from 'bun:test'
import {
  type TouchScrollDrag,
  touchScrollDrag,
  touchScrollStep,
} from './terminal-touch-scroll.helpers'

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

describe('touchScrollDrag', () => {
  test('a seeded drag scrolls by the distance the finger moved', () => {
    const next = touchScrollDrag({ lastY: 300, carry: 0 }, 360, CELL)
    expect(next.lines).toBe(-3)
    expect(next.drag.lastY).toBe(360)
  })

  test('a drag with no reference point takes one rather than scrolling', () => {
    const next = touchScrollDrag({ lastY: null, carry: 0 }, 520, CELL)
    expect(next.lines).toBe(0)
    expect(next.drag.lastY).toBe(520)
  })

  test('a second finger interrupting a drag neither jumps nor kills it', () => {
    // A finger seeded at 300 has dragged to 360.
    const dragging = touchScrollDrag({ lastY: 300, carry: 0 }, 360, CELL)
    expect(dragging.lines).toBe(-3)

    // A second finger landing fires its own touchstart, which drops the
    // reference point.
    const interrupted: TouchScrollDrag = { lastY: null, carry: 0 }

    // The first move after that re-seeds, so the 160px gap since 360 is not
    // read as an eight row fling through the scrollback.
    const resumed = touchScrollDrag(interrupted, 520, CELL)
    expect(resumed.lines).toBe(0)

    // And the drag is live again rather than dead until every finger lifts.
    expect(touchScrollDrag(resumed.drag, 620, CELL).lines).toBe(-5)
  })

  test('the carried remainder survives across moves within one drag', () => {
    let drag: TouchScrollDrag = { lastY: 300, carry: 0 }
    let scrolled = 0
    // Three 8px nudges are 1.2 rows in total, so one row has to land.
    for (const y of [308, 316, 324]) {
      const next = touchScrollDrag(drag, y, CELL)
      drag = next.drag
      scrolled += next.lines
    }
    expect(scrolled).toBe(-1)
    expect(drag.carry).toBeCloseTo(0.2)
  })

  test('re-seeding drops the stale remainder with the stale position', () => {
    const next = touchScrollDrag({ lastY: null, carry: 0.9 }, 400, CELL)
    expect(next.drag.carry).toBe(0)
  })
})
