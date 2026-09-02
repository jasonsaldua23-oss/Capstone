import { jwtVerify } from 'jose'
import { isPathAllowedForPortal, parseNativePortalFromUserAgent } from '@/lib/portal-scope'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

type AppVariant = 'all' | 'admin' | 'driver' | 'customer'
type PortalType = 'admin' | 'warehouse' | 'driver' | 'customer'

interface AuthPayload {
  role?: string
  type?: 'staff' | 'customer'
}

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'logistics-management-secret-key-2024'
)

function resolveVariant(): AppVariant {
  const raw = String(process.env.NEXT_PUBLIC_APP_VARIANT || '').trim().toLowerCase()
  if (raw === 'admin' || raw === 'driver' || raw === 'customer' || raw === 'all') {
    return raw
  }
  return 'all'
}

function allowedPortalsForVariant(variant: AppVariant): PortalType[] {
  if (variant === 'admin') return ['admin', 'warehouse']
  if (variant === 'driver') return ['driver']
  if (variant === 'customer') return ['customer']
  return ['admin', 'warehouse', 'driver', 'customer']
}

function defaultLoginPathForVariant(variant: AppVariant): string {
  if (variant === 'driver') return '/login/driver'
  if (variant === 'customer') return '/login/customer'
  return '/login/admin'
}

function extractPortalFromLoginPath(pathname: string): PortalType | null {
  // Sub-routes such as /login/admin/forgot-password belong to the same portal and
  // must be gated by the deployment variant exactly like the login page itself.
  const portals: PortalType[] = ['admin', 'warehouse', 'driver', 'customer']
  return (
    portals.find((portal) => pathname === `/login/${portal}` || pathname.startsWith(`/login/${portal}/`)) || null
  )
}

/**
 * The deployment variant a Capacitor shell corresponds to.
 *
 * The shell's own portal is the tighter of the two limits and is applied on top of
 * the deployment's, so the Driver app is held to the driver rules even on the
 * shared deployment that serves every portal.
 */
function variantForShellPortal(portal: PortalType): AppVariant {
  if (portal === 'driver') return 'driver'
  if (portal === 'customer') return 'customer'
  return 'admin'
}

function isRoleAllowedForVariant(payload: AuthPayload, variant: AppVariant): boolean {
  if (variant === 'all') return true
  if (variant === 'driver') return payload.type === 'staff' && payload.role === 'DRIVER'
  if (variant === 'customer') return payload.type === 'customer'
  return payload.type === 'staff' && payload.role !== 'DRIVER'
}

async function getPayload(request: NextRequest): Promise<AuthPayload | null> {
  const authHeader = request.headers.get('authorization')
  const headerToken = authHeader?.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : undefined
  const cookieToken = request.cookies.get('auth_token')?.value
  const token = headerToken || cookieToken
  if (!token) return null

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    return payload as AuthPayload
  } catch {
    return null
  }
}

function isAllowedAuthRouteForVariant(pathname: string, variant: AppVariant): boolean {
  if (pathname === '/api/auth/logout' || pathname === '/api/auth/me') {
    return true
  }

  if (
    pathname === '/api/auth/email-verification/request' ||
    pathname === '/api/auth/email-verification/confirm' ||
    pathname === '/api/auth/staff/google' ||
    pathname === '/api/auth/login/verify-otp'
  ) {
    return true
  }

  if (variant === 'driver') {
    return pathname === '/api/auth/login'
  }

  if (variant === 'customer') {
    return pathname === '/api/auth/customer/login' || pathname === '/api/auth/register' || pathname === '/api/auth/customer/google'
  }

  if (variant === 'admin') {
    return pathname === '/api/auth/login'
  }

  return true
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const variant = resolveVariant()
  // The Driver and Shop apps stamp their portal into the user agent, because every
  // portal shares this origin and Capacitor can only restrict the shell by host.
  const shellPortal = parseNativePortalFromUserAgent(request.headers.get('user-agent'))
  const shellVariant = shellPortal ? variantForShellPortal(shellPortal) : null
  const allowedPortals = shellPortal
    ? allowedPortalsForVariant(variant).filter((portal) => portal === shellPortal)
    : allowedPortalsForVariant(variant)
  const defaultLoginPath = shellPortal ? `/login/${shellPortal}` : defaultLoginPathForVariant(variant)

  // Nothing outside the shell's own portal is served to it at all - not the portal
  // chooser, not another portal's login, not the recovery pages.
  if (shellPortal && !isPathAllowedForPortal(pathname, shellPortal)) {
    return NextResponse.redirect(new URL(defaultLoginPath, request.url))
  }

  if (pathname === '/login') {
    // The shared deployment has no default role: valid sessions return to their
    // role-resolved portal, while signed-out users choose one of the four logins.
    if (variant === 'all') {
      const payload = await getPayload(request)
      return payload
        ? NextResponse.redirect(new URL('/', request.url))
        : NextResponse.next()
    }
    return NextResponse.redirect(new URL(defaultLoginPath, request.url))
  }

  if (pathname.startsWith('/login/')) {
    const targetPortal = extractPortalFromLoginPath(pathname)
    if (targetPortal && !allowedPortals.includes(targetPortal)) {
      return NextResponse.redirect(new URL(defaultLoginPath, request.url))
    }
    return NextResponse.next()
  }

  if (pathname.startsWith('/api/auth/')) {
    if (
      !isAllowedAuthRouteForVariant(pathname, variant) ||
      (shellVariant && !isAllowedAuthRouteForVariant(pathname, shellVariant))
    ) {
      return NextResponse.json({ success: false, error: 'Forbidden for this app variant' }, { status: 403 })
    }
    return NextResponse.next()
  }

  if (pathname.startsWith('/api/')) {
    const payload = await getPayload(request)
    if (!payload) {
      return NextResponse.next()
    }

    if (
      !isRoleAllowedForVariant(payload, variant) ||
      (shellVariant && !isRoleAllowedForVariant(payload, shellVariant))
    ) {
      return NextResponse.json({ success: false, error: 'Forbidden for this app variant' }, { status: 403 })
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt).*)'],
}
