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
