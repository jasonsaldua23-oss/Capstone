import { getCurrentUser, apiResponse, apiError, unauthorizedError } from '@/lib/auth'
import { db } from '@/lib/db'

// GET /api/categories - List all categories
export async function GET() {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()

    const categories = await db.productCategory.findMany({
      where: { isActive: true },
      include: {
        _count: {
          select: { products: true },
        },
      },
      orderBy: { name: 'asc' },
    })

    return apiResponse({
      success: true,
      data: categories,
    })
  } catch (error) {
    console.error('Get categories error:', error)
    return apiError('Failed to fetch categories', 500)
  }
}
