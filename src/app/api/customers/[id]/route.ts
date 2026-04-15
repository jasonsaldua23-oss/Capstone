import { NextRequest } from 'next/server'
import { getCurrentUser, apiResponse, apiError, unauthorizedError, forbiddenError, hashPassword, createToken, setAuthCookie } from '@/lib/auth'
import { db } from '@/lib/db'

// GET /api/customers/[id] - Get customer by ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()

    const { id } = await params
    
    // Customers can only see their own data
    if (currentUser.type === 'customer' && currentUser.userId !== id) {
      return forbiddenError()
    }

    const customer = await db.customer.findUnique({
      where: { id },
    })

    if (!customer) {
      return apiError('Customer not found', 404)
    }

    const { password, ...safeCustomer } = customer
    // Provide avatar consistently even if runtime Prisma client does not include it.
    if ((safeCustomer as Record<string, unknown>).avatar === undefined) {
      try {
        const rows = await db.$queryRaw<Array<{ avatar: string | null }>>`
          SELECT "avatar" FROM "Customer" WHERE "id" = ${id} LIMIT 1
        `
        ;(safeCustomer as Record<string, unknown>).avatar = rows?.[0]?.avatar ?? null
      } catch {
        // ignore
      }
    }

    return apiResponse({
      success: true,
      data: safeCustomer,
    })
  } catch (error) {
    console.error('Get customer error:', error)
    return apiError('Failed to fetch customer', 500)
  }
}

// PUT /api/customers/[id] - Update customer
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()

    const { id } = await params
    
    // Customers can only update their own data, staff can update any
    if (currentUser.type === 'customer' && currentUser.userId !== id) {
      return forbiddenError()
    }

    const body = await request.json()
    const { 
      name, email, phone, 
      address, city, state, zipCode, country,
      latitude, longitude,
      avatar,
      password,
      isActive 
    } = body

    const updateData: Record<string, unknown> = {}
    
    if (name !== undefined) updateData.name = String(name).trim()
    if (email !== undefined) updateData.email = String(email).trim()
    if (phone !== undefined) updateData.phone = phone || null
    if (address !== undefined) updateData.address = address || null
    if (city !== undefined) updateData.city = city || null
    if (state !== undefined) updateData.state = state || null
    if (zipCode !== undefined) updateData.zipCode = zipCode || null
    if (country !== undefined) updateData.country = String(country).trim() || 'Philippines'
    if (latitude !== undefined) updateData.latitude = latitude || null
    if (longitude !== undefined) updateData.longitude = longitude || null
    if (password) updateData.password = await hashPassword(password)
    
    // Only admins can change isActive status
    if (currentUser.type === 'staff' && typeof isActive === 'boolean') {
      updateData.isActive = isActive
    }

    let customer = await db.customer.update({
      where: { id },
      data: updateData,
    })

    // Persist avatar via SQL fallback so photo updates still work even
    // when runtime Prisma client is out of date.
    let persistedAvatar: string | null | undefined = undefined
    if (avatar !== undefined) {
      persistedAvatar = avatar || null
      try {
        await db.$executeRaw`UPDATE "Customer" SET "avatar" = ${persistedAvatar} WHERE "id" = ${id}`
      } catch {
        // Ignore avatar persistence fallback error; main profile update still succeeds.
      }
    }

    const { password: _, ...safeCustomer } = customer
    if (persistedAvatar !== undefined) {
      ;(safeCustomer as Record<string, unknown>).avatar = persistedAvatar
    }

    if (currentUser.type === 'customer' && currentUser.userId === id) {
      const refreshedToken = await createToken({
        userId: customer.id,
        email: customer.email,
        name: customer.name,
        avatar: persistedAvatar !== undefined ? persistedAvatar : (customer as any).avatar ?? null,
        role: 'CUSTOMER',
        type: 'customer',
      })
      await setAuthCookie(refreshedToken)
    }

    return apiResponse({
      success: true,
      data: safeCustomer,
      message: 'Customer updated successfully',
    })
  } catch (error) {
    console.error('Update customer error:', error)
    const message = error instanceof Error ? error.message : 'Failed to update customer'
    return apiError(message, 500)
  }
}

// DELETE /api/customers/[id] - Delete customer
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()
    if (currentUser.type !== 'staff') return forbiddenError()

    const { id } = await params

    await db.customer.delete({
      where: { id },
    })

    return apiResponse({
      success: true,
      message: 'Customer deleted successfully',
    })
  } catch (error) {
    console.error('Delete customer error:', error)
    return apiError('Failed to delete customer', 500)
  }
}
