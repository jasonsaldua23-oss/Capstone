import { NextRequest } from 'next/server'
import { getCurrentUser, apiResponse, apiError, unauthorizedError, forbiddenError, isAdmin, hashPassword } from '@/lib/auth'
import { db } from '@/lib/db'

// GET /api/customers - List all customers
export async function GET(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '20')
    const search = searchParams.get('search') || ''

    const where: Record<string, unknown> = {}
    
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { email: { contains: search } },
        { phone: { contains: search } },
      ]
    }

    const [customers, total] = await Promise.all([
      db.customer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.customer.count({ where }),
    ])

    // Remove passwords from response
    const safeCustomers = customers.map(({ password, ...customer }) => customer)

    return apiResponse({
      success: true,
      data: safeCustomers,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    })
  } catch (error) {
    console.error('Get customers error:', error)
    return apiError('Failed to fetch customers', 500)
  }
}

// POST /api/customers - Create new customer
export async function POST(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()
    if (!isAdmin(currentUser.role)) return forbiddenError()

    const body = await request.json()
    const { 
      name, email, password, phone, 
      address, city, state, zipCode, country,
      latitude, longitude 
    } = body

    if (!name || !email || !password) {
      return apiError('Name, email, and password are required')
    }

    // Check if email exists
    const existingCustomer = await db.customer.findUnique({
      where: { email },
    })

    if (existingCustomer) {
      return apiError('Customer with this email already exists')
    }

    const hashedPassword = await hashPassword(password)

    const customer = await db.customer.create({
      data: {
        name,
        email,
        password: hashedPassword,
        phone: phone || null,
        address: address || null,
        city: city || null,
        state: state || null,
        zipCode: zipCode || null,
        country: country || 'USA',
        latitude: latitude || null,
        longitude: longitude || null,
      },
    })

    const { password: _, ...safeCustomer } = customer

    return apiResponse({
      success: true,
      data: safeCustomer,
      message: 'Customer created successfully',
    })
  } catch (error) {
    console.error('Create customer error:', error)
    return apiError('Failed to create customer', 500)
  }
}
