<script lang="ts">
  import './layout.css';
  import SiteHeader from '#lib/SiteHeader.svelte';
  import SiteFooter from '#lib/SiteFooter.svelte';
  import SeoHead from '#lib/SeoHead.svelte';
  import type { LayoutProps } from './$types';
  let { children }: LayoutProps = $props();
</script>
<svelte:head><link rel="icon" href="/agent-terminal-icon.svg" /></svelte:head>
<SeoHead />
<SiteHeader />
{@render children()}
<SiteFooter />
