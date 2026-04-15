import { NextRequest } from 'next/server'
import { getCurrentUser, apiResponse, apiError, unauthorizedError } from '@/lib/auth'
import { db } from '@/lib/db'

// GET /api/products - List all products
export async function GET(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '20')
    const search = searchParams.get('search') || ''
    const categoryId = searchParams.get('categoryId') || ''

    const where: Record<string, unknown> = { isActive: true }
    
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { sku: { contains: search } },
      ]
    }
    
    if (categoryId) {
      where.categoryId = categoryId
    }

    const [products, total] = await Promise.all([
      db.product.findMany({
        where,
        include: {
          category: true,
          inventory: {
            select: {
              quantity: true,
              reservedQuantity: true,
              warehouse: { select: { name: true, code: true } },
            },
          },
        },
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.product.count({ where }),
    ])

    return apiResponse({
      success: true,
      data: products,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    })
  } catch (error) {
    console.error('Get products error:', error)
    return apiError('Failed to fetch products', 500)
  }
}

// POST /api/products - Create new product
export async function POST(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()

    const body = await request.json()
    const { 
      sku, name, imageUrl, description, categoryId, unit,
      weight, dimensions, price 
    } = body

    if (!sku || !name) {
      return apiError('SKU and name are required')
    }

    // Check if SKU exists
    const existingProduct = await db.product.findUnique({
      where: { sku },
    })

    if (existingProduct) {
      return apiError('Product with this SKU already exists')
    }

    const product = await db.product.create({
      data: {
        sku,
        name,
        imageUrl: imageUrl || null,
        description: description || null,
        categoryId: categoryId || null,
        unit: unit || 'piece',
        weight: weight || null,
        dimensions: dimensions || null,
        price: price || 0,
      },
      include: { category: true },
    })

    return apiResponse({
      success: true,
      data: product,
      message: 'Product created successfully',
    })
  } catch (error) {
    console.error('Create product error:', error)
    return apiError('Failed to create product', 500)
  }
}
