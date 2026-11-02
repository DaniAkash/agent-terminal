# Agent Terminal landing page

This repository contains the public landing site for the open-source Agent Terminal project. Product source and current feature details are available in the adjacent `../agent-terminal` checkout when present and at https://github.com/DaniAkash/agent-terminal. Verify product claims against that source rather than inventing features, supported platforms, prices, or release details.

## Stack and commands

- SvelteKit 3, Svelte 5, TypeScript, Vite, and Tailwind CSS 4.
- Use Bun for dependency management and project scripts: `bun install`, `bun run dev`, `bun run check`, and `bun run build`.
- The project uses Svelte 5 runes and `#lib` imports. Shared styles are in `src/routes/layout.css`.
- Run `bun run check` after code changes and `bun run build` for changes affecting routing, rendering, dependencies, or deployment. Verify responsive UI at mobile and desktop widths when changing layouts.

## Project map

- `src/routes/+page.svelte`: homepage.
- `src/routes/agents/+page.svelte`: agent support directory.
- `src/routes/docs/+page.svelte`: product documentation.
- `src/routes/changelog/`: GitHub release timeline; the server load provides initial content and the client loads additional releases.
- `src/routes/+layout.svelte`, `src/lib/SiteHeader.svelte`, and `src/lib/SiteFooter.svelte`: global layout and navigation.
- `src/lib/AsciiField.svelte`, `src/lib/RibbonField.svelte`, and `src/lib/InstallTerminal.svelte`: interactive visual components. Respect reduced-motion preferences and clean up listeners and animation frames.
- `src/lib/seo.ts` and `src/lib/SeoHead.svelte`: page metadata and structured data. Canonical production origin is `https://agent-terminal.org`.
- `static/robots.txt`, `static/sitemap.xml`, `static/llms.txt`, and `static/og-image.jpg`: crawler and social-preview assets. Keep these accurate and consistent with the canonical origin and public pages.
- `static/illustrations/` and `static/agent-terminal-icon.svg`: product imagery and branding.

## Implementation notes

- Preserve the existing dark, monochrome visual direction and ensure contrast and keyboard accessibility. Use Phosphor for UI icons and the existing brand-icon assets for agent logos.
- Keep product content useful in server-rendered HTML; avoid making important information dependent only on client-side JavaScript. The changelog fetches GitHub releases dynamically and must retain a usable error state.
- Do not broaden the allowed hosts in `vite.config.ts` unnecessarily. Preview/noncanonical hosts should remain `noindex`.
- Keep links, screenshots, metadata, mobile/desktop behavior, and `llms.txt` aligned when changing a feature or release claim. Do not treat `llms.txt` or structured data as a guarantee of search placement.
- Do not edit the adjacent Agent Terminal repository as part of site work unless the user requests it.
