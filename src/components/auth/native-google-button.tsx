'use client'

/**
 * "Continue with Google" for the Capacitor shells.
 *
 * The web Identity Services button cannot run in an app web view, so the shells
 * get this one instead: it opens the OS account picker and hands back an ID token
 * for the same Web client the browser uses, which the caller posts to the same
 * endpoint as before. It renders nothing until the plugin reports itself ready,
 * so a build without native sign-in configured shows no dead control.
 */

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

import { canSignInWithGoogleNatively, signInWithGoogleNatively } from '@/lib/native/google-auth'

function GoogleMark() {
  return (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  )
}

type NativeGoogleButtonProps = {
  /** Receives the ID token to post to the portal's Google sign-in endpoint. */
  onCredential: (idToken: string) => void | Promise<void>
  onError: (message: string) => void
  disabled?: boolean
}

export function NativeGoogleButton({ onCredential, onError, disabled }: NativeGoogleButtonProps) {
  const [isAvailable, setIsAvailable] = useState(false)
  const [isSigningIn, setIsSigningIn] = useState(false)

  useEffect(() => {
    let cancelled = false
    void canSignInWithGoogleNatively().then((available) => {
      if (!cancelled) setIsAvailable(available)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!isAvailable) return null

  const startSignIn = async () => {
    setIsSigningIn(true)
    try {
      const result = await signInWithGoogleNatively()
      if (result.ok) {
        await onCredential(result.idToken)
        return
      }
      // An empty message is the person closing the account picker themselves.
      if (result.message) onError(result.message)
    } finally {
      setIsSigningIn(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void startSignIn()}
      disabled={disabled || isSigningIn}
      className="inline-flex h-11 w-full max-w-[340px] items-center justify-center gap-2.5 rounded-full border border-[#DDE3EA] bg-white text-[14px] font-semibold text-[#2A2A2A] transition-colors hover:bg-[#F7F9FC] disabled:opacity-60 motion-reduce:transition-none"
    >
      {isSigningIn ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <GoogleMark />}
      {isSigningIn ? 'Signing in' : 'Continue with Google'}
    </button>
  )
}
