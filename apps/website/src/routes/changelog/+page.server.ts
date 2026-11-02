import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
  try {
    const response = await fetch('https://api.github.com/repos/DaniAkash/agent-terminal/releases?per_page=5&page=1', {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(3500)
    });
    if (!response.ok) return { initialReleases: [], initialHasMore: false };
    const releases = await response.json();
    if (!Array.isArray(releases)) return { initialReleases: [], initialHasMore: false };
    return { initialReleases: releases.filter((release) => !release.draft), initialHasMore: response.headers.get('Link')?.includes('rel="next"') ?? releases.length === 5 };
  } catch {
    return { initialReleases: [], initialHasMore: false };
  }
};
