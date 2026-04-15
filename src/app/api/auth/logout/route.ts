import { clearAuthCookie, apiResponse } from '@/lib/auth'

export async function POST() {
  try {
    await clearAuthCookie()
    
    return apiResponse({
      success: true,
      message: 'Logged out successfully',
    })
  } catch (error) {
    console.error('Logout error:', error)
    return apiResponse({
      success: true,
      message: 'Logged out successfully',
    })
  }
}
