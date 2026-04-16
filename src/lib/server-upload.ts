import { mkdir, writeFile } from 'fs/promises'
import path from 'path'

interface SaveImageOptions {
  file: File
  folder: 'products' | 'pods' | 'customers'
  fileName: string
}

function getSupabaseEnv() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const bucket = process.env.SUPABASE_UPLOADS_BUCKET || 'uploads'
  return { url, serviceRoleKey, bucket }
}

async function saveToSupabaseStorage({ file, folder, fileName }: SaveImageOptions): Promise<string> {
  const { url, serviceRoleKey, bucket } = getSupabaseEnv()
  if (!url || !serviceRoleKey) {
    throw new Error('Supabase storage environment variables are not configured')
  }

  const objectPath = `${folder}/${fileName}`
  const bytes = await file.arrayBuffer()
  const uploadUrl = `${url}/storage/v1/object/${bucket}/${objectPath}`
  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      'Content-Type': file.type || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: Buffer.from(bytes),
  })

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`Supabase storage upload failed: ${response.status} ${details}`)
  }

  return `${url}/storage/v1/object/public/${bucket}/${objectPath}`
}

async function saveToLocalPublicUploads({ file, folder, fileName }: SaveImageOptions): Promise<string> {
  const uploadDir = path.join(process.cwd(), 'public', 'uploads', folder)
  const filePath = path.join(uploadDir, fileName)
  await mkdir(uploadDir, { recursive: true })
  const bytes = await file.arrayBuffer()
  await writeFile(filePath, Buffer.from(bytes))
  return `/uploads/${folder}/${fileName}`
}

export async function saveImageFile(options: SaveImageOptions): Promise<string> {
  const { url, serviceRoleKey } = getSupabaseEnv()

  // Prefer durable cloud storage in production deployments.
  if (url && serviceRoleKey) {
    return saveToSupabaseStorage(options)
  }

  // Local fallback for development environments.
  return saveToLocalPublicUploads(options)
}
