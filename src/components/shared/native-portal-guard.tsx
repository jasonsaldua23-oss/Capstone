'use client'

/**
 * Holds the Driver and Shop apps to their own portal for the whole app, including
 * the login routes that live outside the portal shell in page.tsx.
 *
 * It renders nothing; the work is the navigation lock it installs on mount.
 */

import { useEffect } from 'react'

// Fix: load the one-shot PWA install event listener on login pages as well as the
// authenticated portal, so an eligible Driver event is not lost before login.
import '@/lib/native/install-prompt'
import { installPortalLock } from '@/lib/native/portal-lock'

export function NativePortalGuard() {
  useEffect(() => installPortalLock(), [])
  return null
}
