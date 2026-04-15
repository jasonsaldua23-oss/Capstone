import { getCurrentUser, apiResponse, unauthorizedError } from '@/lib/auth'

export async function GET() {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return unauthorizedError()
    }

    return apiResponse({
      success: true,
      user,
    })
  } catch (error) {
    console.error('Get current user error:', error)
    return unauthorizedError()
  }
}
