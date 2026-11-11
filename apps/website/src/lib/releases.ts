export const RELEASES_URL =
  'https://github.com/DaniAkash/agent-terminal/releases/latest'
export const RELEASE_API =
  'https://api.github.com/repos/DaniAkash/agent-terminal/releases/latest'
export const LATEST_DOWNLOAD = `${RELEASES_URL}/download`

export type Release = {
  version: string
  assets: { name: string; browser_download_url: string }[]
}

export function parseRelease(value: unknown): Release | null {
  if (!value || typeof value !== 'object') return null
  const release = value as Record<string, unknown>
  if (
    typeof release.tag_name !== 'string' ||
    !release.tag_name.trim() ||
    !Array.isArray(release.assets)
  )
    return null
  const assets = release.assets.filter(
    (asset): asset is Release['assets'][number] => {
      if (
        !asset ||
        typeof asset.name !== 'string' ||
        typeof asset.browser_download_url !== 'string'
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
    },
  )
  return { version: release.tag_name, assets }
}
