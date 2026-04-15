import { getCurrentUser, apiResponse, apiError, unauthorizedError, forbiddenError, isAdmin } from '@/lib/auth'
import { db } from '@/lib/db'

// GET /api/roles - List all roles
export async function GET() {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()

    const roles = await db.role.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { users: true },
        },
      },
    })

    return apiResponse({
      success: true,
      data: roles,
    })
  } catch (error) {
    console.error('Get roles error:', error)
    return apiError('Failed to fetch roles', 500)
  }
}
