import { useStore } from '@nanostores/react'
import { Redirect, useLocalSearchParams } from 'expo-router'
import { $session } from '@/modules/stores/$session'
import { SwitcherSheet } from '@/screens/switcher/SwitcherSheet'

export default function SwitcherRoute() {
  const session = useStore($session)
  // Passed by the terminal so the sheet can mark where you already are.
  const { current } = useLocalSearchParams<{ current?: string }>()
  if (session.status !== 'connected') {
    return <Redirect href="/connect" />
  }
  return <SwitcherSheet currentKey={current} />
}
