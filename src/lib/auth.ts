import bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'
import type { JWTPayload } from 'jose'
import { cookies, headers } from 'next/headers'
import { db } from './db'
import type { User, Customer, Role } from '@prisma/client'

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'logistics-management-secret-key-2024'
)

const TOKEN_NAME = 'auth_token'
const TOKEN_EXPIRY = 24 * 60 * 60 * 1000 // 24 hours

export interface AuthPayload {
  userId: string
  email: string
  name: string
  avatar?: string | null
  role: string
  type: 'staff' | 'customer'
}

// Password utilities
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword)
}

// JWT utilities
export async function createToken(payload: AuthPayload): Promise<string> {
  return new SignJWT(payload as unknown as JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(JWT_SECRET)
}

export async function verifyToken(token: string): Promise<AuthPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    return payload as unknown as AuthPayload
  } catch {
    return null
  }
}

// Cookie utilities
export async function setAuthCookie(token: string) {
  const cookieStore = await cookies()
  cookieStore.set(TOKEN_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: TOKEN_EXPIRY / 1000,
    path: '/',
  })
}

export async function getAuthCookie(): Promise<string | undefined> {
  const cookieStore = await cookies()
  return cookieStore.get(TOKEN_NAME)?.value
}

export async function getAuthHeaderToken(): Promise<string | undefined> {
  const headerStore = await headers()
  const authHeader = headerStore.get('authorization')
  if (!authHeader) return undefined

  const [scheme, token] = authHeader.split(' ')
  if (scheme?.toLowerCase() !== 'bearer') return undefined
  return token
}

export async function clearAuthCookie() {
  const cookieStore = await cookies()
  cookieStore.delete(TOKEN_NAME)
}

// Authentication functions
export async function authenticateStaff(
  email: string,
  password: string
): Promise<{ success: boolean; user?: AuthPayload; error?: string }> {
  const user = await db.user.findUnique({
    where: { email },
    include: { role: true },
  })

  if (!user) {
    return { success: false, error: 'Invalid email or password' }
  }

  if (!user.isActive) {
    return { success: false, error: 'Account is deactivated' }
  }

  const isValid = await verifyPassword(password, user.password)
  if (!isValid) {
    return { success: false, error: 'Invalid email or password' }
  }

  // Update last login
  await db.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  })

  return {
    success: true,
    user: {
      userId: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      role: user.role.name,
      type: 'staff',
    },
  }
}

export async function authenticateCustomer(
  email: string,
  password: string
): Promise<{ success: boolean; user?: AuthPayload; error?: string }> {
  const customer = await db.customer.findUnique({
    where: { email },
  })

  if (!customer) {
    return { success: false, error: 'Invalid email or password' }
  }

  if (!customer.isActive) {
    return { success: false, error: 'Account is deactivated' }
  }

  const isValid = await verifyPassword(password, customer.password)
  if (!isValid) {
    return { success: false, error: 'Invalid email or password' }
  }

  return {
    success: true,
    user: {
      userId: customer.id,
      email: customer.email,
      name: customer.name,
      avatar: customer.avatar,
      role: 'CUSTOMER',
      type: 'customer',
    },
  }
}

// Get current user from token
export async function getCurrentUser(): Promise<AuthPayload | null> {
  const headerToken = await getAuthHeaderToken()
  if (headerToken) {
    const headerPayload = await verifyToken(headerToken)
    if (headerPayload) {
      return headerPayload
    }
  }

  const cookieToken = await getAuthCookie()
  if (!cookieToken) return null

  const cookiePayload = await verifyToken(cookieToken)
  return cookiePayload
}

// Get full user data
export async function getCurrentUserData(): Promise<{
  user?: (User & { role: Role }) | Customer
  type?: 'staff' | 'customer'
} | null> {
  const payload = await getCurrentUser()
  if (!payload) return null

  if (payload.type === 'staff') {
    const user = await db.user.findUnique({
      where: { id: payload.userId },
      include: { role: true },
    })
    return user ? { user, type: 'staff' } : null
  } else {
    const customer = await db.customer.findUnique({
      where: { id: payload.userId },
    })
    return customer ? { user: customer, type: 'customer' } : null
  }
}

// Role-based access control
export function hasRole(requiredRoles: string[], userRole: string): boolean {
  return requiredRoles.includes(userRole)
}

export function isAdmin(role: string): boolean {
  return ['SUPER_ADMIN', 'ADMIN'].includes(role)
}

export function isDriver(role: string): boolean {
  return role === 'DRIVER'
}

export function isWarehouseStaff(role: string): boolean {
  return role === 'WAREHOUSE_STAFF'
}

export function isCustomer(role: string): boolean {
  return role === 'CUSTOMER'
}

// API response helper
export function apiResponse<T>(data: T, status = 200): Response {
  return Response.json(data, { status })
}

export function apiError(message: string, status = 400): Response {
  return Response.json({ success: false, error: message }, { status })
}

export function unauthorizedError(): Response {
  return Response.json(
    { success: false, error: 'Unauthorized' },
    { status: 401 }
  )
}

export function forbiddenError(): Response {
  return Response.json(
    { success: false, error: 'Forbidden' },
    { status: 403 }
  )
}
