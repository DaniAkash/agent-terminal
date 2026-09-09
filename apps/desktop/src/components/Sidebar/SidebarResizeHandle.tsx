// biome-ignore-all lint/a11y/useSemanticElements: the rule suggests <hr> for
// role="separator", but <hr> is neither focusable nor draggable. A focusable
// separator carrying aria-valuenow is the ARIA window-splitter pattern, which
// is exactly what this control is.

import { useStore } from '@nanostores/react'
import { useRef } from 'react'
import {
  $sidebarWidth,
  applySidebarWidthToDocument,
  clampSidebarWidth,
  resetSidebarWidth,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  setSidebarWidth,
  sidebarMaxForViewport,
} from '@/modules/stores/$sidebarWidth'

/* ---------------------------------------------------------------------------
 * SidebarResizeHandle: drag affordance on the sidebar's right edge.
 *
 * Wide invisible hit area over the 1px border, which is far too thin to
 * grab. Only a hover tint is drawn; the border itself stays the visible
 * seam.
 *
 * Starts below the header row because the header is a
 * `data-tauri-drag-region`: a pointer press inside that region is claimed
 * by the OS to move the window, so a handle overlapping it would move the
 * window instead of resizing.
 *
 * During a drag the CSS variable is written directly rather than through
 * the store. That keeps React out of the hot path, and persistence to
 * localStorage happens once on release rather than on every pointer move.
 * The terminal still re-fits on every frame because its ResizeObserver
 * watches the real DOM.
 * -------------------------------------------------------------------------*/

const HEADER_HEIGHT = 38
const ARROW_STEP = 8
const ARROW_STEP_LARGE = 32

export function SidebarResizeHandle() {
  const width = useStore($sidebarWidth)
  const drag = useRef<{
    startX: number
    startWidth: number
    next: number
  } | null>(null)

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    const startWidth = $sidebarWidth.get()
    drag.current = { startX: e.clientX, startWidth, next: startWidth }
    e.currentTarget.setPointerCapture(e.pointerId)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d) return
    d.next = clampSidebarWidth(
      d.startWidth + (e.clientX - d.startX),
      sidebarMaxForViewport(window.innerWidth),
    )
    applySidebarWidthToDocument(d.next)
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d) return
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    setSidebarWidth(d.next)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? ARROW_STEP_LARGE : ARROW_STEP
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      setSidebarWidth($sidebarWidth.get() - step)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      setSidebarWidth($sidebarWidth.get() + step)
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_WIDTH_MIN}
      aria-valuemax={SIDEBAR_WIDTH_MAX}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={resetSidebarWidth}
      onKeyDown={onKeyDown}
      style={{ top: HEADER_HEIGHT }}
      className="absolute right-0 bottom-0 z-10 w-2 translate-x-1/2 cursor-col-resize bg-transparent transition-colors hover:bg-sidebar-border focus-visible:bg-sidebar-border focus-visible:outline-none"
    />
  )
}
