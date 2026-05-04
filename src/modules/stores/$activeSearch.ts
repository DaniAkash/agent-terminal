import { atom } from 'nanostores'

export type SearchState = {
  tabKey: string
  query: string
  matchCase: boolean
  wholeWord: boolean
  regex: boolean
}

/**
 * Drives the find-in-scrollback overlay. Non-null when the search bar is
 * open over the active terminal; null otherwise. The bar reads `query` /
 * options from here and writes back via `setSearchQuery`.
 */
export const $activeSearch = atom<SearchState | null>(null)

export function openSearch(tabKey: string): void {
  $activeSearch.set({
    tabKey,
    query: '',
    matchCase: false,
    wholeWord: false,
    regex: false,
  })
}

export function closeSearch(): void {
  $activeSearch.set(null)
}

export function setSearchQuery(query: string): void {
  const cur = $activeSearch.get()
  if (cur) $activeSearch.set({ ...cur, query })
}
