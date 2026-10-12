import { computed } from 'nanostores'
import { recencyOrder } from './$recency.helpers'
import { $session } from './$session'

/**
 * Sessions in most-recently-used order, derived from whatever the desktop
 * last told us. Recomputes on every Projects frame, which is also how the
 * order stays honest when the desktop is the one being worked in.
 *
 * A run of swipes must NOT walk this directly: landing on an entry bumps
 * it to the front, so the next step would return where it started. Freeze
 * it with `beginSwipe` for the duration of a run.
 */
export const $recency = computed($session, (session) =>
  recencyOrder(session.projects),
)
