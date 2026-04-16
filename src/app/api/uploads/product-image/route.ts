import { NextRequest } from 'next/server'
import { apiError, apiResponse, forbiddenError, getCurrentUser, unauthorizedError } from '@/lib/auth'
import { getImageUploadFromFormData, saveImageFile } from '@/lib/server-upload'

export async function POST(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()
    if (currentUser.type !== 'staff') return forbiddenError()

    const formData = await request.formData()
    const file = getImageUploadFromFormData(formData)

    const extension = file.name.includes('.') ? file.name.split('.').pop() : 'png'
    const safeExt = String(extension || 'png').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'png'
    const fileName = `product-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`
    const imageUrl = await saveImageFile({
      file,
      folder: 'products',
      fileName,
    })

    return apiResponse({
      success: true,
      imageUrl,
    })
  } catch (error: any) {
    console.error('Upload product image error:', error)
    return apiError(error?.message || 'Failed to upload image', 500)
  }
}
