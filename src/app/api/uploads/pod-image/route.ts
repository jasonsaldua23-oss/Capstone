import { NextRequest } from 'next/server'
import { apiError, apiResponse, forbiddenError, getCurrentUser, unauthorizedError } from '@/lib/auth'
import { getImageUploadFromFormData, saveImageFile } from '@/lib/server-upload'

export async function POST(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()
    if (currentUser.type !== 'staff') return forbiddenError()
    if (String(currentUser.role || '').toUpperCase() !== 'DRIVER') return forbiddenError()

    const formData = await request.formData()
    const file = getImageUploadFromFormData(formData)

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
  } catch (error: any) {
    console.error('Upload POD image error:', error)
    return apiError(error?.message || 'Failed to upload POD image', 500)
  }
}
