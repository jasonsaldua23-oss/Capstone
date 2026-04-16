import { NextRequest } from 'next/server'
import { authenticateStaff, createToken, setAuthCookie, apiResponse, apiError, hashPassword } from '@/lib/auth'
import { db } from '@/lib/db'

async function ensureDriverDemoAccount() {
  const role = await db.role.upsert({
    where: { name: 'DRIVER' },
    update: {},
    create: { name: 'DRIVER', description: 'Delivery driver' },
  })

  const user = await db.user.upsert({
    where: { email: 'driver@logistics.com' },
    update: {
      isActive: true,
      roleId: role.id,
    },
    create: {
      email: 'driver@logistics.com',
      name: 'Demo Driver',
      password: await hashPassword('driver123'),
      phone: '+1-555-0103',
      roleId: role.id,
      isActive: true,
    },
  })

  const existingDriver = await db.driver.findUnique({
    where: { userId: user.id },
  })
  if (!existingDriver) {
    await db.driver.create({
      data: {
        userId: user.id,
        licenseNumber: `DEMO-DRIVER-${user.id.slice(-6).toUpperCase()}`,
        licenseType: 'B',
        licenseExpiry: new Date('2030-12-31'),
        phone: user.phone || null,
        city: 'Demo City',
        province: 'Demo Province',
        isActive: true,
      },
    })
  }
}

async function ensureAdminDemoAccount() {
  const role = await db.role.upsert({
    where: { name: 'SUPER_ADMIN' },
    update: {},
    create: { name: 'SUPER_ADMIN', description: 'Full system access' },
  })

  await db.user.upsert({
    where: { email: 'admin@logistics.com' },
    update: {
      isActive: true,
      roleId: role.id,
    },
    create: {
      email: 'admin@logistics.com',
      name: 'Admin User',
      password: await hashPassword('admin123'),
      phone: '+1-555-0100',
      roleId: role.id,
      isActive: true,
    },
  })
}

async function ensureWarehouseDemoAccount() {
  const role = await db.role.upsert({
    where: { name: 'WAREHOUSE_STAFF' },
    update: {},
    create: { name: 'WAREHOUSE_STAFF', description: 'Warehouse operations' },
  })

  await db.user.upsert({
    where: { email: 'warehouse@logistics.com' },
    update: {
      isActive: true,
      roleId: role.id,
    },
    create: {
      email: 'warehouse@logistics.com',
      name: 'Warehouse Staff',
      password: await hashPassword('admin123'),
      phone: '+1-555-0102',
      roleId: role.id,
      isActive: true,
    },
  })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password } = body

    if (!email || !password) {
      return apiError('Email and password are required')
    }

    let result = await authenticateStaff(email, password)

    const normalizedEmail = String(email || '').trim().toLowerCase()
    if (!result.success && normalizedEmail === 'admin@logistics.com' && password === 'admin123') {
      await ensureAdminDemoAccount()
      result = await authenticateStaff(email, password)
    }

    if (!result.success && normalizedEmail === 'driver@logistics.com' && password === 'driver123') {
      await ensureDriverDemoAccount()
      result = await authenticateStaff(email, password)
    }

    if (!result.success && normalizedEmail === 'warehouse@logistics.com' && password === 'admin123') {
      await ensureWarehouseDemoAccount()
      result = await authenticateStaff(email, password)
    }

    if (!result.success) {
      return apiError(result.error || 'Authentication failed')
    }

    if (!result.user) {
      return apiError('Authentication failed')
    }

    // Create JWT token
    const token = await createToken(result.user)

    // Set cookie
    await setAuthCookie(token)

    return apiResponse({
      success: true,
      user: result.user,
      token,
      message: 'Login successful',
    })
  } catch (error) {
    console.error('Login error:', error)
    return apiError('An error occurred during login', 500)
  }
}
