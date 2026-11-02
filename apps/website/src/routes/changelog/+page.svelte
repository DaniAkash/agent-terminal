<script lang="ts">
import { ArrowUpRight, GitCommit } from 'phosphor-svelte'
import { onMount, untrack } from 'svelte'
import type { PageData } from './$types'

type Release = {
  id: number
  tag_name: string
  name: string | null
  body: string | null
  html_url: string
  published_at: string | null
  prerelease: boolean
  draft: boolean
}
type NoteLine = { type: 'heading' | 'bullet' | 'text' | 'space'; text: string }
type InlinePart = {
  text: string
  href?: string
  strong?: boolean
  code?: boolean
}
let { data }: { data: PageData } = $props()
let releases = $state<Release[]>(untrack(() => data.initialReleases))
let loading = $state(untrack(() => releases.length === 0))
let error = $state('')
let page = $state(1)
let hasMore = $state(untrack(() => data.initialHasMore))
let activeController: AbortController | undefined

function lines(body: string | null): NoteLine[] {
  if (!body?.trim())
    return [{ type: 'text', text: 'See the release on GitHub for details.' }]
  return body
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      const value = line.trim()
      if (!value) return { type: 'space', text: '' }
      const heading = value.match(/^#{1,6}\s+(.+)$/)
      if (heading) return { type: 'heading', text: heading[1] }
      const bullet = value.match(/^(?:[-*+]\s+|\d+\.\s+)(.*)$/)
      if (bullet) return { type: 'bullet', text: bullet[1] }
      return { type: 'text', text: value }
    })
}
function inline(value: string): InlinePart[] {
  const parts: InlinePart[] = []
  const pattern =
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|(https?:\/\/[^\s<>]+)/g
  let previous = 0
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > previous) parts.push({ text: value.slice(previous, index) })
    if (match[1]) parts.push({ text: match[1], href: match[2] })
    else if (match[3]) parts.push({ text: match[3], strong: true })
    else if (match[4]) parts.push({ text: match[4], code: true })
    else parts.push({ text: match[5], href: match[5] })
    previous = index + match[0].length
  }
  if (previous < value.length) parts.push({ text: value.slice(previous) })
  return parts
}
function date(value: string | null) {
  if (!value) return 'Release date unavailable'
  return new Intl.DateTimeFormat('en', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value))
}
async function loadReleases(nextPage = 1) {
  loading = true
  error = ''
  activeController?.abort()
  const controller = new AbortController()
  activeController = controller
  try {
    const response = await fetch(
      `https://api.github.com/repos/DaniAkash/agent-terminal/releases?per_page=5&page=${nextPage}`,
      {
        signal: controller.signal,
        headers: { Accept: 'application/vnd.github+json' },
      },
    )
    if (!response.ok) throw new Error('GitHub could not return the releases.')
    const data: Release[] = await response.json()
    const published = data.filter((release) => !release.draft)
    releases = nextPage === 1 ? published : [...releases, ...published]
    hasMore =
      response.headers.get('Link')?.includes('rel="next"') ?? data.length === 5
    page = nextPage
  } catch (_err) {
    if (!controller.signal.aborted)
      error =
        'Could not load releases from GitHub. Please try again in a moment.'
  } finally {
    if (!controller.signal.aborted) loading = false
  }
}
onMount(() => {
  if (releases.length === 0) void loadReleases()
  return () => activeController?.abort()
})
</script>

<main class="changelog-page">
  <div class="changelog-hero">
    <div class="changelog-kicker"><GitCommit size={15} /> THE BUILD LOG</div>
    <h1>Always moving<br><span>forward.</span></h1>
    <p>
      New features, fixes, and improvements. Follow along as Agent Terminal gets
      better, one release at a time.
    </p>
    <a
      href="https://github.com/DaniAkash/agent-terminal/releases"
      target="_blank"
      rel="noreferrer"
      >View releases on GitHub <ArrowUpRight size={14} /></a
    >
  </div>
  <div class="changelog-rule"><span>CHANGELOG</span></div>
  {#if loading && releases.length === 0}
    <div class="release-state" role="status">
      <span class="loading-dot"></span>
      Loading releases from GitHub…
    </div>
  {:else if error && releases.length === 0}
    <div class="release-state" role="alert">
      <p>{error}</p>
      <button type="button" onclick={() => loadReleases()}>Try again</button
      ><a href="https://github.com/DaniAkash/agent-terminal/releases"
        >View releases on GitHub <ArrowUpRight size={14} /></a
      >
    </div>
  {:else if releases.length === 0}
    <div class="release-state">No published releases yet. Check back soon.</div>
  {:else}
    <div class="release-timeline">
      {#each releases as release, index (release.id)}
        <article class="release">
          <div class="release-meta">
            <div class="timeline-dot"></div>
            <time datetime={release.published_at ?? undefined}
              >{date(release.published_at)}</time
            ><a
              class="release-tag"
              href={release.html_url}
              target="_blank"
              rel="noreferrer"
              >{release.tag_name} <ArrowUpRight size={12} /></a
            >
            {#if index === 0 && page >= 1 && !release.prerelease}
              <span class="latest-label">LATEST</span>
            {/if}
            {#if release.prerelease}
              <span class="latest-label">PRE-RELEASE</span>
            {/if}
          </div>
          <div class="release-content">
            <div class="release-heading">
              <div>
                <span class="release-mobile-date"
                  >{date(release.published_at)}</span
                >
                <h2>{release.name || release.tag_name}</h2>
              </div>
              <a
                href={release.html_url}
                target="_blank"
                rel="noreferrer"
                aria-label={`View ${release.tag_name} on GitHub`}
                ><ArrowUpRight size={18} /></a
              >
            </div>
            <div class="release-notes">
              {#each lines(release.body) as line}
                {#if line.type === 'heading'}
                  <h3>
                    {#each inline(line.text) as part}
                      {part.text}
                    {/each}
                  </h3>
                {:else if line.type === 'space'}
                  <div class="note-space"></div>
                {:else}
                  <p class:note-bullet={line.type === 'bullet'}>
                    {#if line.type === 'bullet'}
                      <span class="note-marker">—</span>
                    {/if}
                    <span
                      >{#each inline(line.text) as part}
                        {#if part.href}
                          <a href={part.href} target="_blank" rel="noreferrer"
                            >{part.text}</a
                          >
                        {:else if part.strong}
                          <strong>{part.text}</strong>
                        {:else if part.code}
                          <code>{part.text}</code>
                        {:else}
                          {part.text}
                        {/if}
                      {/each}</span
                    >
                  </p>
                {/if}
              {/each}
            </div>
          </div>
        </article>
      {/each}
    </div>
    {#if error}
      <div class="release-state" role="alert">
        {error}
        <button type="button" onclick={() => loadReleases(page + 1)}>
          Try again
        </button>
      </div>
    {/if}
    {#if hasMore}
      <button
        type="button"
        class="load-releases"
        disabled={loading}
        onclick={() => loadReleases(page + 1)}
      >
        {loading ? 'Loading…' : 'Load earlier releases'} <span>↓</span>
      </button>
    {/if}
  {/if}
</main>
