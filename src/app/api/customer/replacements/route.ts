import { db } from '@/lib/db'
import { apiResponse, unauthorizedError, getCurrentUser } from '@/lib/auth'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user || user.type !== 'customer') {
      return unauthorizedError()
    }

    const replacements = await db.return.findMany({
      where: { customerId: user.userId },
      select: {
        id: true,
        orderId: true,
        returnNumber: true,
        reason: true,
        description: true,
        status: true,
        replacementMode: true,
        originalOrderItemId: true,
        replacementProductId: true,
        replacementQuantity: true,
        damagePhotoUrl: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    return apiResponse({
      success: true,
      replacements,
    })
  } catch (error) {
    console.error('Get customer replacements error:', error)
    return apiResponse({
      success: false,
      replacements: [],
    }, 500)
  }
}
