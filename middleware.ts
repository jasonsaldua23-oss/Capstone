import { jwtVerify } from 'jose'
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
  if (pathname === '/login/admin') return 'admin'
  if (pathname === '/login/warehouse') return 'warehouse'
  if (pathname === '/login/driver') return 'driver'
  if (pathname === '/login/customer') return 'customer'
  return null
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

  if (variant === 'driver') {
    return pathname === '/api/auth/login'
  }

  if (variant === 'customer') {
    return pathname === '/api/auth/customer/login' || pathname === '/api/auth/register'
  }

  if (variant === 'admin') {
    return pathname === '/api/auth/login'
  }

  return true
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const variant = resolveVariant()
  const allowedPortals = allowedPortalsForVariant(variant)
  const defaultLoginPath = defaultLoginPathForVariant(variant)

  if (pathname === '/login') {
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
    if (!isAllowedAuthRouteForVariant(pathname, variant)) {
      return NextResponse.json({ success: false, error: 'Forbidden for this app variant' }, { status: 403 })
    }
    return NextResponse.next()
  }

  if (pathname.startsWith('/api/')) {
    const payload = await getPayload(request)
    if (!payload) {
      return NextResponse.next()
    }

    if (!isRoleAllowedForVariant(payload, variant)) {
      return NextResponse.json({ success: false, error: 'Forbidden for this app variant' }, { status: 403 })
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt).*)'],
}
