import { apiError, apiResponse, getCurrentUser, unauthorizedError } from '@/lib/auth'
import { db, isDatabaseUnavailableError } from '@/lib/db'

function getNotificationOwnerFilter(user: { type: 'staff' | 'customer'; userId: string }) {
  if (user.type === 'staff') {
    return { userId: user.userId }
  }
  return { customerId: user.userId }
}

// GET /api/notifications
export async function GET() {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()

    const ownerFilter = getNotificationOwnerFilter(currentUser)
    const notifications = await db.notification.findMany({
      where: ownerFilter,
      orderBy: { createdAt: 'desc' },
      take: 20,
    })

    return apiResponse({
      success: true,
      notifications,
      unreadCount: notifications.filter((item) => !item.isRead).length,
    })
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return apiResponse({
        success: false,
        dbUnavailable: true,
        notifications: [],
        unreadCount: 0,
        error: 'Database is temporarily unavailable',
      })
    }

    console.error('Get notifications error:', error)
    return apiError('Failed to fetch notifications', 500)
  }
}

// PATCH /api/notifications
// Body: { markAll?: boolean, id?: string }
export async function PATCH(request: Request) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()

    const body = await request.json().catch(() => ({}))
    const markAll = Boolean(body?.markAll)
    const id = String(body?.id || '')
    const ownerFilter = getNotificationOwnerFilter(currentUser)
    const now = new Date()

    if (markAll) {
      await db.notification.updateMany({
        where: {
          ...ownerFilter,
          isRead: false,
        },
        data: {
          isRead: true,
          readAt: now,
        },
      })

      return apiResponse({ success: true, message: 'All notifications marked as read' })
    }

    if (!id) {
      return apiError('Notification id is required', 400)
    }

    const updated = await db.notification.updateMany({
      where: {
        id,
        ...ownerFilter,
      },
      data: {
        isRead: true,
        readAt: now,
      },
    })

    if (updated.count === 0) {
      return apiError('Notification not found', 404)
    }

    return apiResponse({ success: true, message: 'Notification marked as read' })
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return apiResponse({
        success: false,
        dbUnavailable: true,
        error: 'Database is temporarily unavailable',
      })
    }

    console.error('Update notifications error:', error)
    return apiError('Failed to update notification', 500)
  }
}
