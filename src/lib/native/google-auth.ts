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
  return (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '').trim()
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
  // A timed-out bridge check must not mistake a web shim for a usable plugin.
  if (!(await waitForNativeBridge())) return false
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
  try {
    // Include readiness errors in the result instead of leaving an unhandled rejection.
    if (!(await canSignInWithGoogleNatively())) {
      return { ok: false, message: 'Google sign-in is not available on this device.' }
    }
    await ensureInitialised()
    const { SocialLogin } = await import('@capgo/capacitor-social-login')
    const response = await SocialLogin.login({
      provider: 'google',
      // The Android plugin already requests the email/profile/openid defaults.
      // Passing a custom scopes array requires a special MainActivity marker and
      // made the customer Capacitor shell reject Google sign-in before opening it.
      options: {},
    })

    const idToken = (response.result as { idToken?: string | null })?.idToken
    if (!idToken) {
      return { ok: false, message: 'Google did not return an account to sign in with.' }
    }
    return { ok: true, idToken }
  } catch (error) {
    const reason = String((error as Error)?.message || '')
    // Fix: Android can report cancellation after account selection, too. Do not
    // swallow it: a closed picker without a token must explain why login stopped.
    return {
      ok: false,
      message: reason || 'Google sign-in did not complete. Please choose your account and try again.',
    }
  }
}
