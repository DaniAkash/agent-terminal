import type { Terminal } from '@xterm/xterm'

/**
 * Turn a finger's vertical movement into a whole number of terminal rows.
 *
 * xterm scrolls its viewport on wheel events and scrollbar drags, neither
 * of which a finger produces. It ships a Gesture module that would cover
 * this, but nothing in the library ever registers a target for it, so no
 * gesture events are emitted and the scrollback is unreachable by touch.
 * Android wires this through its own inlined copy in the terminal HTML,
 * since that runs as a plain script rather than a module.
 */

export interface TouchScrollStep {
  /** Rows to scroll. Negative reveals earlier output, matching `scrollLines`. */
  lines: number
  /** Sub-row movement to carry into the next event. */
  carry: number
}

/**
 * Accumulate movement in fractional rows rather than truncating per event.
 *
 * A drag arrives as many small deltas. Rounding each one to a whole row
 * independently floors a slow drag to zero every time and the viewport
 * never moves, so the remainder has to survive between events.
 *
 * Dragging down reveals earlier output, which `scrollLines` expresses as a
 * negative amount, hence the inversion here rather than at the call site.
 */
export function touchScrollStep(
  deltaY: number,
  cellHeight: number,
  carry: number,
): TouchScrollStep {
  // A zero or nonsensical cell height means the terminal has not been laid
  // out yet. Swallow the movement rather than dividing by it.
  if (!Number.isFinite(cellHeight) || cellHeight <= 0) {
    return { lines: 0, carry }
  }

  const total = carry + deltaY / cellHeight
  // Truncate toward zero so the leftover always keeps the drag's direction.
  const whole = total > 0 ? Math.floor(total) : Math.ceil(total)

  if (whole === 0) return { lines: 0, carry: total }
  return { lines: -whole, carry: total - whole }
}

/**
 * Wire a vertical drag on the terminal to its viewport, and return the
 * teardown. `touch-action: none` on the terminal elements is what stops the
 * browser claiming the drag before this sees it.
 */
export function attachTouchScroll(term: Terminal): () => void {
  const el = term.element
  if (!el) return () => {}

  let lastY: number | null = null
  let carry = 0

  const onStart = (e: TouchEvent) => {
    const touch = e.touches.length === 1 ? e.touches[0] : undefined
    if (!touch) {
      lastY = null
      return
    }
    lastY = touch.clientY
    carry = 0
  }

  const onMove = (e: TouchEvent) => {
    const touch = e.touches.length === 1 ? e.touches[0] : undefined
    if (lastY === null || !touch) return
    const dy = touch.clientY - lastY
    lastY = touch.clientY
    const step = touchScrollStep(dy, el.clientHeight / (term.rows || 1), carry)
    carry = step.carry
    if (step.lines === 0) return
    term.scrollLines(step.lines)
    e.preventDefault()
  }

  const onEnd = () => {
    lastY = null
  }

  el.addEventListener('touchstart', onStart, { passive: true })
  el.addEventListener('touchmove', onMove, { passive: false })
  el.addEventListener('touchend', onEnd, { passive: true })
  el.addEventListener('touchcancel', onEnd, { passive: true })

  return () => {
    el.removeEventListener('touchstart', onStart)
    el.removeEventListener('touchmove', onMove)
    el.removeEventListener('touchend', onEnd)
    el.removeEventListener('touchcancel', onEnd)
  }
}
