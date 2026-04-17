import { db, isDatabaseUnavailableError } from '@/lib/db'

type StaffRoleName = 'SUPER_ADMIN' | 'ADMIN' | 'WAREHOUSE_STAFF'

interface NotificationPayload {
  title: string
  message: string
  type?: string
  referenceType?: string
  referenceId?: string
}

async function createCustomerNotification(customerId: string, payload: NotificationPayload) {
  if (!customerId) return

  await db.notification.create({
    data: {
      customerId,
      title: payload.title,
      message: payload.message,
      type: payload.type || 'general',
      referenceType: payload.referenceType || null,
      referenceId: payload.referenceId || null,
    },
  })
}

async function createStaffNotificationsByRoles(roles: StaffRoleName[], payload: NotificationPayload) {
  if (roles.length === 0) return

  const staffUsers = await db.user.findMany({
    where: {
      isActive: true,
      role: {
        name: {
          in: roles,
        },
      },
    },
    select: { id: true },
  })

  if (staffUsers.length === 0) return

  await db.notification.createMany({
    data: staffUsers.map((staffUser) => ({
      userId: staffUser.id,
      title: payload.title,
      message: payload.message,
      type: payload.type || 'general',
      referenceType: payload.referenceType || null,
      referenceId: payload.referenceId || null,
    })),
  })
}

async function safeNotify(action: string, run: () => Promise<void>) {
  try {
    await run()
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      console.warn(`${action} skipped: database unavailable`)
      return
    }
    console.error(`${action} failed:`, error)
  }
}

export async function notifyOrderCreated(params: {
  orderId: string
  orderNumber: string
  customerId: string
}) {
  const { orderId, orderNumber, customerId } = params

  await safeNotify('notifyOrderCreated', async () => {
    await Promise.all([
      createCustomerNotification(customerId, {
        title: 'Order placed',
        message: `Your order ${orderNumber} has been placed successfully.`,
        type: 'order_update',
        referenceType: 'order',
        referenceId: orderId,
      }),
      createStaffNotificationsByRoles(['SUPER_ADMIN', 'ADMIN', 'WAREHOUSE_STAFF'], {
        title: 'New order received',
        message: `Order ${orderNumber} has been created and requires processing.`,
        type: 'order_update',
        referenceType: 'order',
        referenceId: orderId,
      }),
    ])
  })
}

export async function notifyOrderStatusChanged(params: {
  orderId: string
  orderNumber: string
  customerId: string
  status: string
}) {
  const { orderId, orderNumber, customerId, status } = params
  const normalizedStatus = String(status || '').toUpperCase().replace(/_/g, ' ')

  await safeNotify('notifyOrderStatusChanged', async () => {
    await createCustomerNotification(customerId, {
      title: 'Order status updated',
      message: `Your order ${orderNumber} is now ${normalizedStatus}.`,
      type: 'order_update',
      referenceType: 'order',
      referenceId: orderId,
    })
  })
}

export async function notifyOrderCancelledByCustomer(params: {
  orderId: string
  orderNumber: string
  customerId: string
}) {
  const { orderId, orderNumber, customerId } = params

  await safeNotify('notifyOrderCancelledByCustomer', async () => {
    await Promise.all([
      createCustomerNotification(customerId, {
        title: 'Order cancelled',
        message: `Your order ${orderNumber} has been cancelled.`,
        type: 'order_update',
        referenceType: 'order',
        referenceId: orderId,
      }),
      createStaffNotificationsByRoles(['SUPER_ADMIN', 'ADMIN', 'WAREHOUSE_STAFF'], {
        title: 'Order cancelled by customer',
        message: `Order ${orderNumber} was cancelled by the customer.`,
        type: 'order_update',
        referenceType: 'order',
        referenceId: orderId,
      }),
    ])
  })
}

export async function notifyReplacementStatusChanged(params: {
  returnId: string
  returnNumber: string
  customerId: string
  status: string
}) {
  const { returnId, returnNumber, customerId, status } = params
  const normalizedStatus = String(status || '').toUpperCase().replace(/_/g, ' ')

  await safeNotify('notifyReplacementStatusChanged', async () => {
    await Promise.all([
      createCustomerNotification(customerId, {
        title: 'Replacement status updated',
        message: `Replacement ${returnNumber} is now ${normalizedStatus}.`,
        type: 'return_update',
        referenceType: 'return',
        referenceId: returnId,
      }),
      createStaffNotificationsByRoles(['SUPER_ADMIN', 'ADMIN', 'WAREHOUSE_STAFF'], {
        title: 'Replacement updated',
        message: `Replacement ${returnNumber} moved to ${normalizedStatus}.`,
        type: 'return_update',
        referenceType: 'return',
        referenceId: returnId,
      }),
    ])
  })
}
