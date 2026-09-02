'use client'

/**
 * Holds the Driver and Shop apps to their own portal for the whole app, including
 * the login routes that live outside the portal shell in page.tsx.
 *
 * It renders nothing; the work is the navigation lock it installs on mount.
 */

import { useEffect } from 'react'

import { installPortalLock } from '@/lib/native/portal-lock'

export function NativePortalGuard() {
  useEffect(() => installPortalLock(), [])
  return null
}
