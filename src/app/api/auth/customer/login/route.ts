import { NextRequest } from 'next/server'
import { authenticateCustomer, createToken, setAuthCookie, apiResponse, apiError } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password } = body

    if (!email || !password) {
      return apiError('Email and password are required')
    }

    const result = await authenticateCustomer(email, password)

    if (!result.success) {
      return apiError(result.error || 'Authentication failed')
    }

    if (!result.user) {
      return apiError('Authentication failed')
    }

    // Create JWT token
    const token = await createToken(result.user)

    // Set cookie
    await setAuthCookie(token)

    return apiResponse({
      success: true,
      user: result.user,
      token,
      message: 'Login successful',
    })
  } catch (error) {
    console.error('Customer login error:', error)
    return apiError('An error occurred during login', 500)
  }
}
