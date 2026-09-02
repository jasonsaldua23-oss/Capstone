/**
 * Google sign-in inside the Capacitor shells.
 *
 * Google refuses OAuth from an embedded web view - the request comes back as
 * `disallowed_useragent` - and Identity Services additionally needs FedCM and
 * third-party cookies, neither of which the Android web view provides. So the web
 * "Sign in with Google" button cannot work in the app at all, and the shells sign
 * in natively instead, through Google Play Services.
 *
 * What comes back is an ID token minted for the same Web client ID the browser
 * uses, so it lands on the existing /api/auth/customer/google endpoint unchanged:
 * the server verifies exactly the audience it already verifies today.
 */

import { isNativeApp, isPluginAvailable, waitForNativeBridge } from './platform'

export type NativeGoogleSignIn =
  | { ok: true; idToken: string }
  | { ok: false; message: string }

/** The Web OAuth client the ID token must be minted for. */
function webClientId(): string {
  return process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ''
}

let initialised = false

/**
 * True when this runtime can sign in natively: a shell, with the plugin
 * registered and a client ID to hand. Waits for the bridge, which arrives after
 * the page on a shell that loads the portal over the network.
 */
export async function canSignInWithGoogleNatively(): Promise<boolean> {
  if (typeof window === 'undefined' || !isNativeApp()) return false
  if (!webClientId()) return false
  await waitForNativeBridge()
  return isPluginAvailable('SocialLogin')
}

async function ensureInitialised(): Promise<void> {
  if (initialised) return
  const { SocialLogin } = await import('@capgo/capacitor-social-login')
  await SocialLogin.initialize({
    google: {
      webClientId: webClientId(),
      // The server only needs to identify the person, not act for them later.
      mode: 'online',
    },
  })
  initialised = true
}

/**
 * Runs the OS account picker and returns the ID token for the chosen account.
 *
 * Call it from a tap: the picker is a system dialog and Android expects it to
 * follow a deliberate action.
 */
export async function signInWithGoogleNatively(): Promise<NativeGoogleSignIn> {
  if (!(await canSignInWithGoogleNatively())) {
    return { ok: false, message: 'Google sign-in is not available on this device.' }
  }

  try {
    await ensureInitialised()
    const { SocialLogin } = await import('@capgo/capacitor-social-login')
    const response = await SocialLogin.login({
      provider: 'google',
      options: { scopes: ['email', 'profile'] },
    })

    const idToken = (response.result as { idToken?: string | null })?.idToken
    if (!idToken) {
      return { ok: false, message: 'Google did not return an account to sign in with.' }
    }
    return { ok: true, idToken }
  } catch (error) {
    const reason = String((error as Error)?.message || '')
    // The person backing out of the account picker is not a failure to report.
    if (/cancel/i.test(reason)) {
      return { ok: false, message: '' }
    }
    return {
      ok: false,
      message: reason || 'Google sign-in could not be completed on this device.',
    }
  }
}
