import { NextRequest } from 'next/server'
import { getCurrentUser, apiResponse, apiError, unauthorizedError, forbiddenError, isAdmin, hashPassword } from '@/lib/auth'
import { db } from '@/lib/db'

// GET /api/users - List all users
export async function GET(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()
    if (!isAdmin(currentUser.role)) return forbiddenError()

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '20')
    const search = searchParams.get('search') || ''
    const roleId = searchParams.get('roleId') || ''

    const where: Record<string, unknown> = {}
    
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { email: { contains: search } },
      ]
    }
    
    if (roleId) {
      where.roleId = roleId
    }

    const [users, total] = await Promise.all([
      db.user.findMany({
        where,
        include: {
          role: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.user.count({ where }),
    ])

    // Remove passwords from response
    const safeUsers = users.map(({ password, ...user }) => user)

    return apiResponse({
      success: true,
      data: safeUsers,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    })
  } catch (error) {
    console.error('Get users error:', error)
    return apiError('Failed to fetch users', 500)
  }
}

// POST /api/users - Create new user
export async function POST(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()
    if (!isAdmin(currentUser.role)) return forbiddenError()

    const body = await request.json()
    const { name, email, password, phone, roleId } = body

    if (!name || !email || !password || !roleId) {
      return apiError('Name, email, password, and role are required')
    }

    // Check if email exists
    const existingUser = await db.user.findUnique({
      where: { email },
    })

    if (existingUser) {
      return apiError('User with this email already exists')
    }

    const hashedPassword = await hashPassword(password)

    const user = await db.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        phone: phone || null,
        roleId,
      },
      include: { role: true },
    })

    const { password: _, ...safeUser } = user

    return apiResponse({
      success: true,
      data: safeUser,
      message: 'User created successfully',
    })
  } catch (error) {
    console.error('Create user error:', error)
    return apiError('Failed to create user', 500)
  }
}
