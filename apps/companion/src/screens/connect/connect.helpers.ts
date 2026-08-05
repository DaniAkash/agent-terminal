export function normaliseWebSocketUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) {
    return trimmed
  }
  return `ws://${trimmed}`
}

export function connectErrorMessage(
  status: string,
  serverError: string | null,
): string | null {
  if (status === 'auth_failed' && serverError)
    return `Auth failed, ${serverError}`
  if (status === 'unreachable') {
    return serverError
      ? `Server not reachable, ${serverError}`
      : 'Server not reachable. Check the URL and your Wi-Fi.'
  }
  return null
}
