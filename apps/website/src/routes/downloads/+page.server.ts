import type { PageServerLoad } from './$types'
import { parseRelease, RELEASE_API } from '../../lib/releases'

export const load: PageServerLoad = async ({ fetch, setHeaders }) => {
  try {
    const response = await fetch(RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(3500),
    })
    if (!response.ok) throw new Error('GitHub release unavailable')
    const release = parseRelease(await response.json())
    if (!release) throw new Error('Invalid release data')
    setHeaders({ 'cache-control': 'public, max-age=300, s-maxage=300' })
    return { release }
  } catch {
    return { release: null }
  }
}
