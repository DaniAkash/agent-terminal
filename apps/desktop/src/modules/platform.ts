/** Desktop host detection for platform-specific window controls. */
export const isLinux =
  typeof navigator !== 'undefined' && /^Linux/i.test(navigator.platform)
