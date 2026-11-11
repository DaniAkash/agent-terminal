<script lang="ts">
import { page } from '$app/state'
import { pages, SITE_NAME, SITE_URL } from './seo'

let path = $derived(page.url.pathname.replace(/\/$/, '') || '/')
let entry = $derived(pages[path])
let canonical = $derived(`${SITE_URL}${path === '/' ? '/' : path}`)
let isProduction = $derived(page.url.hostname === 'agent-terminal.org')
let schema = $derived(
  path === '/'
    ? {
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'WebSite',
            '@id': `${SITE_URL}/#website`,
            url: `${SITE_URL}/`,
            name: SITE_NAME,
            inLanguage: 'en',
          },
          {
            '@type': 'SoftwareApplication',
            '@id': `${SITE_URL}/#app`,
            name: SITE_NAME,
            url: `${SITE_URL}/`,
            description: pages['/'].description,
            applicationCategory: 'DeveloperApplication',
            operatingSystem: 'macOS 13 or later, Linux (experimental)',
            isAccessibleForFree: true,
            downloadUrl: 'https://github.com/DaniAkash/agent-terminal/releases',
            softwareHelp: `${SITE_URL}/docs`,
            sameAs: 'https://github.com/DaniAkash/agent-terminal',
            license:
              'https://github.com/DaniAkash/agent-terminal/blob/main/LICENSE',
            offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' },
          },
        ],
      }
    : null,
)
</script>
<svelte:head>
  {#if entry}
    <title>{entry.title}</title>
    <meta name="description" content={entry.description}>
    {#if path === '/'}
      <link rel="preload" as="image" href="/illustrations/terminal-hero.webp">
    {/if}
    <link rel="canonical" href={canonical}>
    <meta property="og:type" content="website">
    <meta property="og:site_name" content={SITE_NAME}>
    <meta property="og:title" content={entry.title}>
    <meta property="og:description" content={entry.description}>
    <meta property="og:url" content={canonical}>
    <meta property="og:image" content={`${SITE_URL}/og-image.jpg`}>
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta
      property="og:image:alt"
      content="Agent Terminal — one terminal, every agent, total clarity"
    >
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content={entry.title}>
    <meta name="twitter:description" content={entry.description}>
    <meta name="twitter:image" content={`${SITE_URL}/og-image.jpg`}>
    <meta
      name="twitter:image:alt"
      content="Agent Terminal — one terminal, every agent, total clarity"
    >
  {/if}
  {#if !isProduction || !entry}
    <meta name="robots" content="noindex, nofollow">
  {/if}
  <link rel="describedby" type="text/markdown" href="/llms.txt">
  <meta name="theme-color" content="#080808">
  {#if schema}
    {@html `<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>`}
  {/if}
</svelte:head>
