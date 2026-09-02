/**
 * Which portal a request or a page belongs to, and what that portal may open.
 *
 * The Driver and Shop apps are Capacitor shells around the deployed portal rather
 * than bundled copies, so every portal shares one origin and Capacitor's
 * `allowNavigation` - a host list - cannot tell them apart. Each shell therefore
 * stamps `AABPortal/<portal>` into its user agent, and this module turns that token
 * into a decision: a shell only ever sees its own login, its own portal and the
 * shared assets underneath them.
 *
 * The module is deliberately dependency-free so the Edge middleware, the browser
 * and the native path filter can all agree on the same rules.
 */

export type ScopedPortal = 'admin' | 'warehouse' | 'driver' | 'customer'

/** Token appended to the shell's user agent by capacitor.config.ts. */
export const NATIVE_PORTAL_UA_PREFIX = 'AABPortal/'

const SCOPED_PORTALS: ScopedPortal[] = ['admin', 'warehouse', 'driver', 'customer']

/**
 * Paths every shell needs regardless of portal: the SPA shell itself, the API it
 * talks to, uploaded media, and the build's own static output.
 */
const SHARED_PATH_PREFIXES = ['/api/', '/uploads/', '/_next/']

const SHARED_EXACT_PATHS = ['/', '/manifest.webmanifest', '/push-sw.js', '/favicon.ico']

/** Reads the portal a Capacitor shell has stamped into its user agent. */
export function parseNativePortalFromUserAgent(userAgent: string | null | undefined): ScopedPortal | null {
  if (!userAgent) return null
  const match = new RegExp(`${NATIVE_PORTAL_UA_PREFIX}([a-z]+)`, 'i').exec(userAgent)
  if (!match) return null
  const portal = match[1].toLowerCase()
  return SCOPED_PORTALS.includes(portal as ScopedPortal) ? (portal as ScopedPortal) : null
}

export function loginPathForPortal(portal: ScopedPortal): string {
  // Fix: Customer and Driver need disjoint URL prefixes so an installed PWA
  // cannot claim links that belong to the other portal.
  if (portal === 'driver' || portal === 'customer') return `/${portal}/login`
  return `/login/${portal}`
}

/** Canonical page shown after authentication for each portal. */
export function homePathForPortal(portal: ScopedPortal): string {
  if (portal === 'driver' || portal === 'customer') return `/${portal}`
  return '/'
}

/** Customer/Driver portal encoded in a canonical scoped URL, if present. */
export function portalFromAppPath(pathname: string): ScopedPortal | null {
  const path = normalisePath(pathname)
  if (path === '/driver' || path.startsWith('/driver/')) return 'driver'
  if (path === '/customer' || path.startsWith('/customer/')) return 'customer'
  return null
}

/**
 * True when a shell locked to `portal` may load `pathname`.
 *
 * Anything that is not the portal's own page, its own login, or a shared asset is
 * refused - including the `/login` chooser and the `/restore` recovery tools, which
 * exist for the shared browser deployment and have no place inside a portal app.
 */
export function isPathAllowedForPortal(pathname: string, portal: ScopedPortal): boolean {
  const path = normalisePath(pathname)

  if (SHARED_EXACT_PATHS.includes(path)) return true
  if (SHARED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) return true

  const ownHome = homePathForPortal(portal)
  if (ownHome !== '/' && (path === ownHome || path.startsWith(`${ownHome}/`))) return true

  const ownLogin = loginPathForPortal(portal)
  if (path === ownLogin || path.startsWith(`${ownLogin}/`)) return true

  // Preserve old bookmarks long enough for their route-level redirect to run.
  const legacyLogin = `/login/${portal}`
  if (path === legacyLogin || path.startsWith(`${legacyLogin}/`)) return true

  // Static files - icons, images, map data - are shared by every portal, wherever
  // under public/ they happen to live.
  if (!path.startsWith('/login') && /\.[a-z0-9]+$/i.test(path)) return true

  return false
}

function normalisePath(pathname: string): string {
  if (!pathname) return '/'
  const path = pathname.split('?')[0].split('#')[0]
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1)
  return path || '/'
}
