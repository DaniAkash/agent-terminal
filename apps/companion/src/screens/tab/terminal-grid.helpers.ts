/**
 * Grid and scale arithmetic shared by both terminal renderers.
 *
 * The desktop owns the grid: the phone is handed `cols` and `rows` and
 * renders exactly those, because a serialized screen carries cursor moves
 * computed against the width that produced it and cannot be re-rendered at
 * another one. Everything here is therefore about presenting somebody
 * else's grid on a small screen, never about choosing it.
 */

/** Starting grid, replaced by the first authoritative size from the desktop. */
export const INITIAL_TERMINAL_COLS = 80
export const INITIAL_TERMINAL_ROWS = 24

/** 1:1 with the desktop: one terminal cell per CSS pixel it was drawn at. */
export const FULL_TERMINAL_SCALE = 1

/**
 * Floor for any computed scale. A desktop-width grid shrunk to a phone's
 * width lands near 0.3, where 12px glyphs are a grey smear, so fit-width
 * stops here and the rest of the grid is reached by panning.
 */
export const MIN_TERMINAL_SCALE = 0.5

/** Ceiling for pinch. Past this a cell is wider than a fingertip. */
export const MAX_TERMINAL_SCALE = 2

export function clampTerminalScale(scale: number): number {
  if (!Number.isFinite(scale)) return FULL_TERMINAL_SCALE
  return Math.min(MAX_TERMINAL_SCALE, Math.max(MIN_TERMINAL_SCALE, scale))
}

/**
 * Scale at which the grid's full width spans the container.
 *
 * Capped at 1:1 rather than at MAX_TERMINAL_SCALE: a grid narrower than the
 * screen would otherwise be magnified past the size its glyphs were drawn
 * at, which is a choice for pinch to make and not a default.
 */
export function fitWidthScale(
  containerWidth: number,
  cols: number,
  charWidth: number,
): number {
  const gridWidth = cols * charWidth
  if (!(gridWidth > 0) || !(containerWidth > 0)) return FULL_TERMINAL_SCALE
  return Math.min(
    FULL_TERMINAL_SCALE,
    clampTerminalScale(containerWidth / gridWidth),
  )
}

/** Scale for a two-finger drag that started at `startDistance`. */
export function pinchScale(
  startScale: number,
  startDistance: number,
  distance: number,
): number {
  if (!(startDistance > 0) || !(distance > 0)) {
    return clampTerminalScale(startScale)
  }
  return clampTerminalScale((startScale * distance) / startDistance)
}

export interface GridSize {
  cols: number
  rows: number
}

/**
 * Cells a container of this size holds at 1:1.
 *
 * This is the viewport the phone declares to the hub, which may ignore it:
 * it matters only when no desktop window is attached, where it replaces a
 * tab born at a hardcoded 80x24.
 */
export function gridSizeForContainer(
  containerWidth: number,
  containerHeight: number,
  charWidth: number,
  rowHeight: number,
): GridSize | null {
  if (!(charWidth > 0) || !(rowHeight > 0)) return null
  if (!(containerWidth > 0) || !(containerHeight > 0)) return null
  return {
    cols: Math.max(1, Math.floor(containerWidth / charWidth)),
    rows: Math.max(1, Math.floor(containerHeight / rowHeight)),
  }
}

/**
 * What an incoming grid asks of the renderer: nothing at all when the size
 * is not yet measurable, a relayout alone when the grid already matches, a
 * resize otherwise. Separating the three keeps a re-sent identical grid from
 * rebuilding the screen while still letting it re-fit to the viewport.
 */
export type GridApplication = 'ignore' | 'relayout' | 'resize'

export function gridApplication(
  requested: GridSize,
  current: GridSize,
): GridApplication {
  if (!(requested.cols > 0) || !(requested.rows > 0)) return 'ignore'
  if (requested.cols === current.cols && requested.rows === current.rows) {
    return 'relayout'
  }
  return 'resize'
}

export interface TouchPoint {
  x: number
  y: number
}

/** A touch's position, or the origin when the list handed back nothing. */
export function touchPoint(
  touch: { clientX: number; clientY: number } | null | undefined,
): TouchPoint {
  if (!touch) return { x: 0, y: 0 }
  return { x: touch.clientX, y: touch.clientY }
}

/** A pinch is only live once touchstart measured the starting spread. */
export function isPinchGesture(
  touchCount: number,
  pinchStartDistance: number,
): boolean {
  return touchCount === 2 && pinchStartDistance > 0
}

/** How far a finger may wander and still end as a tap rather than a drag. */
export const TAP_SLOP_PX = 16

/** Window in which a second tap counts as a double tap. */
export const DOUBLE_TAP_MS = 300

export function movedBeyondTapSlop(from: TouchPoint, to: TouchPoint): boolean {
  return (
    Math.abs(to.x - from.x) > TAP_SLOP_PX ||
    Math.abs(to.y - from.y) > TAP_SLOP_PX
  )
}

export interface TouchEndState {
  /** Fingers still down after this one lifted. */
  remainingTouches: number
  pinchStartDistance: number
  tapMoved: boolean
  /** Milliseconds since the last tap that armed the double-tap window. */
  sinceLastTap: number
}

export type TouchEndOutcome =
  | 'ignore'
  | 'end-pinch'
  | 'reset-tap'
  | 'toggle-zoom'
  | 'arm-tap'

/**
 * What lifting a finger means. A gesture only resolves once the last finger
 * is up; a pinch and a drag both end by disarming the double-tap window, so
 * the only tap that toggles zoom is a second still one inside it.
 */
export function touchEndOutcome(state: TouchEndState): TouchEndOutcome {
  if (state.remainingTouches > 0) return 'ignore'
  if (state.pinchStartDistance > 0) return 'end-pinch'
  if (state.tapMoved) return 'reset-tap'
  if (state.sinceLastTap < DOUBLE_TAP_MS) return 'toggle-zoom'
  return 'arm-tap'
}
