import { NextRequest } from 'next/server'
import { apiError, apiResponse, forbiddenError, getCurrentUser, unauthorizedError } from '@/lib/auth'
import { saveImageFile } from '@/lib/server-upload'

export async function POST(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()
    if (currentUser.type !== 'staff') return forbiddenError()
    if (String(currentUser.role || '').toUpperCase() !== 'DRIVER') return forbiddenError()

    const formData = await request.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return apiError('Image file is required', 400)
    }

    if (!file.type.startsWith('image/')) {
      return apiError('Only image files are allowed', 400)
    }

    const extension = file.name.includes('.') ? file.name.split('.').pop() : 'png'
    const safeExt = String(extension || 'png').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'png'
    const fileName = `pod-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`
    const imageUrl = await saveImageFile({
      file,
      folder: 'pods',
      fileName,
    })

    return apiResponse({
      success: true,
      imageUrl,
    })
  } catch (error) {
    console.error('Upload POD image error:', error)
    return apiError('Failed to upload POD image', 500)
  }
}
