import { atom } from 'nanostores'

const STORAGE_KEY = 'agent-terminal:font-size'
const DEFAULT = 13
const MIN = 8
const MAX = 32

function readPersisted(): number {
  if (typeof window === 'undefined') return DEFAULT
  const raw = window.localStorage.getItem(STORAGE_KEY)
  const parsed = raw ? Number(raw) : DEFAULT
  return Number.isFinite(parsed)
    ? Math.min(MAX, Math.max(MIN, parsed))
    : DEFAULT
}

export const $fontSize = atom<number>(readPersisted())

$fontSize.subscribe((value) => {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, String(value))
  }
})

export function increaseFontSize(): void {
  $fontSize.set(Math.min(MAX, $fontSize.get() + 1))
}
export function decreaseFontSize(): void {
  $fontSize.set(Math.max(MIN, $fontSize.get() - 1))
}
export function resetFontSize(): void {
  $fontSize.set(DEFAULT)
}
