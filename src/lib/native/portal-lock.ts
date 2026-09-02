/**
 * Keeps a Capacitor shell inside the portal it was built for.
 *
 * The apps load the deployed site, where all four portals share one origin, so a
 * link, a redirect or a client-side route change could otherwise carry the Driver
 * app into the Shop login. Capacitor's `allowNavigation` cannot help - it filters
 * hosts, not paths - so the shell's own portal (stamped into the user agent) is
 * enforced here instead: anything outside it is turned back to that portal's login.
 *
 * The native path filter in PortalWebViewClient.java covers full page loads, and
 * the server middleware covers what the shell requests over the network. This
 * module covers the third route into another portal: the SPA's own in-page
 * navigation, which never leaves the document and so never reaches either.
 */

import { isPathAllowedForPortal, loginPathForPortal, type ScopedPortal } from '@/lib/portal-scope'
import { getNativePortal } from './platform'

/** The portal this runtime is locked to, or null in a browser or PWA. */
export function getLockedPortal(): ScopedPortal | null {
  return getNativePortal()
}

/** Same-origin path of a URL as the shell would navigate to it, or null if elsewhere. */
function samePathname(url: string | URL): string | null {
  try {
    const resolved = new URL(String(url), window.location.href)
    if (resolved.origin !== window.location.origin) return null
    return resolved.pathname
  } catch {
    return null
  }
}

/**
 * Installs the lock. Safe to call anywhere: in a browser, an installed PWA, or a
 * shell whose portal cannot be determined, it does nothing and returns a no-op.
 */
export function installPortalLock(): () => void {
  if (typeof window === 'undefined') return () => {}

  const portal = getLockedPortal()
  if (!portal) return () => {}

  const home = loginPathForPortal(portal)

  const sendHome = () => {
    if (window.location.pathname === home) return
    window.location.replace(home)
  }

  const isOutOfScope = (pathname: string | null): boolean =>
    pathname !== null && !isPathAllowedForPortal(pathname, portal)

  // A page that is already out of scope - a deep link, a restored tab - goes back
  // before it can render.
  if (isOutOfScope(window.location.pathname)) {
    sendHome()
    return () => {}
  }

  const history = window.history
  const originalPush = history.pushState.bind(history)
  const originalReplace = history.replaceState.bind(history)

  const guardedPush: History['pushState'] = (data, unused, url) => {
    if (url != null && isOutOfScope(samePathname(url))) {
      originalReplace(data, unused, home)
      sendHome()
      return
    }
    originalPush(data, unused, url)
  }

  const guardedReplace: History['replaceState'] = (data, unused, url) => {
    if (url != null && isOutOfScope(samePathname(url))) {
      originalReplace(data, unused, home)
      sendHome()
      return
    }
    originalReplace(data, unused, url)
  }

  history.pushState = guardedPush
  history.replaceState = guardedReplace

  // Back and forward can land on a foreign portal that was pushed before the lock
  // was installed, so the current entry is re-checked after every popstate.
  const onPopState = () => {
    if (isOutOfScope(window.location.pathname)) sendHome()
  }

  // Anchors are stopped before the router sees them, so a blocked link does not
  // flash the other portal's page first.
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return
    const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!anchor) return
    if (isOutOfScope(samePathname(anchor.href))) {
      event.preventDefault()
      event.stopPropagation()
      sendHome()
    }
  }

  const originalOpen = window.open.bind(window)
  window.open = ((url?: string | URL, ...rest: unknown[]) => {
    if (url != null && isOutOfScope(samePathname(url))) return null
    return (originalOpen as unknown as (...args: unknown[]) => Window | null)(url, ...rest)
  }) as typeof window.open

  // The patched history is not the whole story: a router that captured
  // history.pushState before this module ran would bypass it, and so would any
  // navigation the app performs some other way. The current path is therefore
  // re-checked on a slow interval, which catches every mechanism for the cost of a
  // string comparison twice a second.
  const sweep = window.setInterval(() => {
    if (isOutOfScope(window.location.pathname)) sendHome()
  }, 500)

  window.addEventListener('popstate', onPopState)
  document.addEventListener('click', onClick, true)

  return () => {
    history.pushState = originalPush
    history.replaceState = originalReplace
    window.open = originalOpen
    window.clearInterval(sweep)
    window.removeEventListener('popstate', onPopState)
    document.removeEventListener('click', onClick, true)
  }
}
