import type { PageServerLoad } from './$types'

type Asset = { name: string; browser_download_url: string }

export const load: PageServerLoad = async ({ fetch, setHeaders }) => {
  try {
    const response = await fetch(
      'https://api.github.com/repos/DaniAkash/agent-terminal/releases/latest',
      {
        headers: { Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(3500),
      },
    )
    if (!response.ok) throw new Error('GitHub release unavailable')
    const release = await response.json()
    if (typeof release.tag_name !== 'string' || !Array.isArray(release.assets))
      throw new Error('Invalid release data')
    const assets: Asset[] = release.assets.filter((asset: Asset) => {
      if (
        typeof asset?.name !== 'string' ||
        typeof asset?.browser_download_url !== 'string'
      )
        return false
      try {
        const url = new URL(asset.browser_download_url)
        return (
          url.protocol === 'https:' &&
          url.hostname === 'github.com' &&
          url.pathname.startsWith(
            '/DaniAkash/agent-terminal/releases/download/',
          )
        )
      } catch {
        return false
      }
    })
    setHeaders({ 'cache-control': 'public, max-age=300, s-maxage=300' })
    return { release: { version: release.tag_name, assets } }
  } catch {
    return { release: null }
  }
}
