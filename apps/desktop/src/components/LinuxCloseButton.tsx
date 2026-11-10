import { getCurrentWindow } from '@tauri-apps/api/window'
import { X } from 'lucide-react'
import { isLinux } from '@/modules/platform'

export function LinuxCloseButton() {
  if (!isLinux) return null

  return (
    <button
      type="button"
      aria-label="Close Agent Terminal"
      title="Close Agent Terminal"
      className="text-tab-fg focus-visible:ring-accent absolute top-1 right-2 z-20 flex h-7 w-8 items-center justify-center rounded transition-colors hover:bg-red-600 hover:text-white focus-visible:ring-2 focus-visible:outline-none"
      onClick={() => void getCurrentWindow().close()}
    >
      <X aria-hidden="true" size={16} strokeWidth={1.5} />
    </button>
  )
}
