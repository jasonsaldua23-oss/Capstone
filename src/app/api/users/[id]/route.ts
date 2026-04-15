import { NextRequest } from 'next/server'
import { getCurrentUser, apiResponse, apiError, unauthorizedError, forbiddenError, isAdmin, hashPassword } from '@/lib/auth'
import { db } from '@/lib/db'

// GET /api/users/[id] - Get user by ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()
    if (!isAdmin(currentUser.role)) return forbiddenError()

    const { id } = await params
    const user = await db.user.findUnique({
      where: { id },
      include: { role: true, driver: true },
    })

    if (!user) {
      return apiError('User not found', 404)
    }

    const { password, ...safeUser } = user

    return apiResponse({
      success: true,
      data: safeUser,
    })
  } catch (error) {
    console.error('Get user error:', error)
    return apiError('Failed to fetch user', 500)
  }
}

// PUT /api/users/[id] - Update user
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()
    if (!isAdmin(currentUser.role)) return forbiddenError()

    const { id } = await params
    const body = await request.json()
    const { name, email, phone, roleId, isActive, password } = body

    const updateData: Record<string, unknown> = {}
    
    if (name) updateData.name = name
    if (email) updateData.email = email
    if (phone !== undefined) updateData.phone = phone || null
    if (roleId) updateData.roleId = roleId
    if (typeof isActive === 'boolean') updateData.isActive = isActive
    if (password) updateData.password = await hashPassword(password)

    const user = await db.user.update({
      where: { id },
      data: updateData,
      include: { role: true },
    })

    const { password: _, ...safeUser } = user

    return apiResponse({
      success: true,
      data: safeUser,
      message: 'User updated successfully',
    })
  } catch (error) {
    console.error('Update user error:', error)
    return apiError('Failed to update user', 500)
  }
}

// DELETE /api/users/[id] - Delete user
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()
    if (!isAdmin(currentUser.role)) return forbiddenError()

    const { id } = await params

    // Prevent deleting self
    if (id === currentUser.userId) {
      return apiError('Cannot delete your own account')
    }

    await db.user.delete({
      where: { id },
    })

    return apiResponse({
      success: true,
      message: 'User deleted successfully',
    })
  } catch (error) {
    console.error('Delete user error:', error)
    return apiError('Failed to delete user', 500)
  }
}
