import { NextRequest } from 'next/server'
import { apiError, apiResponse, forbiddenError, getCurrentUser, unauthorizedError } from '@/lib/auth'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'

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
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'pods')
    const filePath = path.join(uploadDir, fileName)

    await mkdir(uploadDir, { recursive: true })
    const bytes = await file.arrayBuffer()
    await writeFile(filePath, Buffer.from(bytes))

    return apiResponse({
      success: true,
      imageUrl: `/uploads/pods/${fileName}`,
    })
  } catch (error) {
    console.error('Upload POD image error:', error)
    return apiError('Failed to upload POD image', 500)
  }
}
