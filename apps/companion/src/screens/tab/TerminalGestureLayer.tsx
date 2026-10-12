import type { ReactNode } from 'react'
import { View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'

interface TerminalGestureLayerProps {
  onSwipeUp: () => void
  onSwipeBack: () => void
  onSwipeForward: () => void
  children: ReactNode
}

/**
 * Pan recognition over the key rows, and deliberately not over the
 * terminal: a vertical drag there is two thousand lines of scrollback and
 * a long press is xterm's text selection. Putting the recogniser on the
 * keys means the gestures cost no terminal surface at all.
 *
 * The activation offsets are what keep the keys working. Below them the
 * pan never activates and the child Pressable sends its byte exactly as
 * before, so a tap on CTRL is still a tap on CTRL.
 */
export function TerminalGestureLayer({
  onSwipeUp,
  onSwipeBack,
  onSwipeForward,
  children,
}: TerminalGestureLayerProps) {
  // runOnJS: these handlers only navigate, so there is nothing to gain
  // from the UI runtime, and running them directly keeps the worklet
  // plumbing (and its own failure modes) out of a file whose job is to
  // decide which way a finger moved.
  const pan = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetY([-12, 10_000])
    .activeOffsetX([-16, 16])
    .onEnd((e) => {
      // Compare against each other, not against a single threshold: a
      // diagonal flick should resolve to whichever axis the user meant.
      if (Math.abs(e.translationY) > Math.abs(e.translationX)) {
        if (e.translationY < -24) onSwipeUp()
        return
      }
      if (e.translationX < -24) onSwipeBack()
      else if (e.translationX > 24) onSwipeForward()
    })

  // `collapsable={false}` is load-bearing, not defensive. React Native
  // flattens a view that only groups children, and a flattened child
  // leaves the detector with no native view to attach to: the recogniser
  // then never activates and every gesture here is silently dead.
  return (
    <GestureDetector gesture={pan}>
      <View collapsable={false}>{children}</View>
    </GestureDetector>
  )
}
