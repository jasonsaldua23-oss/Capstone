import { NextRequest } from 'next/server'
import { hashPassword, createToken, setAuthCookie, apiResponse, apiError } from '@/lib/auth'
import { db } from '@/lib/db'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, email, password, phone, address, city, province, zipCode } = body

    // Validation
    if (!name || !email || !password) {
      return apiError('Name, email, and password are required')
    }

    if (password.length < 6) {
      return apiError('Password must be at least 6 characters')
    }

    // Check if customer already exists
    const existingCustomer = await db.customer.findUnique({
      where: { email },
    })

    if (existingCustomer) {
      return apiError('An account with this email already exists')
    }

    // Hash password
    const hashedPassword = await hashPassword(password)

    // Create customer
    const customer = await db.customer.create({
      data: {
        name,
        email,
        password: hashedPassword,
        phone: phone || null,
        address: address || null,
        city: city || null,
        province: province || null,
        zipCode: zipCode || null,
      },
    })

    // Create token
    const token = await createToken({
      userId: customer.id,
      email: customer.email,
      name: customer.name,
      avatar: customer.avatar,
      role: 'CUSTOMER',
      type: 'customer',
    })

    // Set cookie
    await setAuthCookie(token)

    return apiResponse({
      success: true,
      user: {
        userId: customer.id,
        email: customer.email,
        name: customer.name,
        avatar: customer.avatar,
        role: 'CUSTOMER',
        type: 'customer',
      },
      token,
      message: 'Registration successful',
    })
  } catch (error) {
    console.error('Registration error:', error)
    return apiError('An error occurred during registration', 500)
  }
}
