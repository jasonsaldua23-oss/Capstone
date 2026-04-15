import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, apiResponse, unauthorizedError } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return unauthorizedError()
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const type = searchParams.get('type')
    const status = searchParams.get('status')

    const where: any = {}
    if (type) {
      where.type = type
    }
    if (status) {
      where.status = status
    }

    // For customers, only show their own feedback
    if (user.type === 'customer') {
      where.customerId = user.userId
    }

    const [feedbacks, total] = await Promise.all([
      db.feedback.findMany({
        where,
        include: {
          customer: {
            select: { id: true, name: true, email: true }
          },
          order: {
            select: { id: true, orderNumber: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.feedback.count({ where })
    ])

    return apiResponse({
      feedbacks,
      total,
      page,
      pageSize: limit,
      totalPages: Math.ceil(total / limit)
    })
  } catch (error) {
    console.error('Get feedback error:', error)
    return apiResponse({
      feedbacks: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0
    })
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.type !== 'customer') {
      return unauthorizedError()
    }

    const body = await request.json()
    const { orderId, type, subject, message, rating } = body

    const numericRating = Number(rating)
    if (!Number.isFinite(numericRating) || numericRating < 1 || numericRating > 5) {
      return apiResponse({ success: false, error: 'Rating must be between 1 and 5' }, 400)
    }
    if (!message || !String(message).trim()) {
      return apiResponse({ success: false, error: 'Feedback message is required' }, 400)
    }

    // Verify the order belongs to the customer and is delivered
    if (orderId) {
      const order = await db.order.findFirst({
        where: {
          id: orderId,
          customerId: user.userId,
          status: 'DELIVERED'
        }
      })

      if (!order) {
        return apiResponse({ 
          success: false, 
          error: 'Order not found or not eligible for feedback' 
        }, 400)
      }

      const existing = await db.feedback.findFirst({
        where: {
          customerId: user.userId,
          orderId: String(orderId),
        },
        select: { id: true },
      })
      if (existing) {
        return apiResponse({ success: false, error: 'You have already submitted a rating for this order' }, 409)
      }
    }

    const feedback = await db.feedback.create({
      data: {
        customerId: user.userId,
        orderId,
        type: type || 'COMPLIMENT',
        subject: subject || 'Delivery Feedback',
        message: String(message).trim(),
        rating: Math.round(numericRating),
      }
    })

    return apiResponse({ success: true, feedback })
  } catch (error) {
    console.error('Create feedback error:', error)
    return apiResponse({ success: false, error: 'Failed to submit feedback' }, 500)
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.type !== 'staff') {
      return unauthorizedError()
    }

    const body = await request.json()
    const { id, status, response } = body ?? {}

    if (!id) {
      return apiResponse({ success: false, error: 'Feedback id is required' }, 400)
    }

    const updateData: Record<string, unknown> = {}
    if (status) updateData.status = status
    if (response !== undefined) updateData.response = response || null
    if (response) {
      updateData.respondedAt = new Date()
      updateData.respondedBy = user.userId
      if (!status) updateData.status = 'RESOLVED'
    }

    const feedback = await db.feedback.update({
      where: { id: String(id) },
      data: updateData,
      include: {
        customer: { select: { id: true, name: true, email: true } },
        order: { select: { id: true, orderNumber: true } },
      },
    })

    return apiResponse({ success: true, feedback })
  } catch (error) {
    console.error('Update feedback error:', error)
    return apiResponse({ success: false, error: 'Failed to update feedback' }, 500)
  }
}
