import { NextRequest } from 'next/server'
import { getCurrentUser, apiResponse, apiError, unauthorizedError, forbiddenError, isAdmin, isWarehouseStaff } from '@/lib/auth'
import { db } from '@/lib/db'
import { getAssignedWarehouseId, isWarehouseScopedStaff } from '@/lib/warehouse-scope'

// GET /api/warehouses - List all warehouses
export async function GET(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '20')
    const search = searchParams.get('search') || ''

    const where: Record<string, unknown> = { isActive: true }
    const isScopedStaff = isWarehouseScopedStaff(currentUser)

    if (isScopedStaff) {
      const assignedWarehouseId = await getAssignedWarehouseId(currentUser.userId)
      if (!assignedWarehouseId) {
        return apiResponse({
          success: true,
          data: [],
          total: 0,
          page,
          pageSize,
          totalPages: 0,
        })
      }
      where.id = assignedWarehouseId
    }
    
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { code: { contains: search } },
        { city: { contains: search } },
      ]
    }

    const [warehouses, total] = await Promise.all([
      db.warehouse.findMany({
        where,
        include: {
          _count: {
            select: { 
              inventory: true,
            },
          },
        },
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.warehouse.count({ where }),
    ])

    return apiResponse({
      success: true,
      data: warehouses,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    })
  } catch (error) {
    console.error('Get warehouses error:', error)
    return apiError('Failed to fetch warehouses', 500)
  }
}

// POST /api/warehouses - Create new warehouse
export async function POST(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()
    if (!isAdmin(currentUser.role) && !isWarehouseStaff(currentUser.role)) return forbiddenError()

    const body = await request.json()
    const { 
      name, code, address, city, state, zipCode, country,
      latitude, longitude, capacity, managerId 
    } = body

    if (!name || !code || !address || !city || !state || !zipCode) {
      return apiError('Name, code, address, city, state, and zipCode are required')
    }

    // Check if code exists
    const existingWarehouse = await db.warehouse.findUnique({
      where: { code },
    })

    if (existingWarehouse) {
      return apiError('Warehouse with this code already exists')
    }

    const warehouse = await db.warehouse.create({
      data: {
        name,
        code,
        address,
        city,
        state,
        zipCode,
        country: country || 'USA',
        latitude: latitude || null,
        longitude: longitude || null,
        capacity: capacity || 1000,
        managerId: managerId || null,
      },
    })

    return apiResponse({
      success: true,
      data: warehouse,
      message: 'Warehouse created successfully',
    })
  } catch (error) {
    console.error('Create warehouse error:', error)
    return apiError('Failed to create warehouse', 500)
  }
}
