import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const resolvedParams = await params
  const filePathSegments = resolvedParams.path || []
  const relativePath = filePathSegments.join('/')

  // Prevent directory traversal
  if (relativePath.includes('..')) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  // 1. Try reading from public/uploads
  const publicMediaRoot = path.join(process.cwd(), 'public', 'uploads')
  const publicFilePath = path.join(publicMediaRoot, ...filePathSegments)

  try {
    const fileBuffer = await fs.readFile(publicFilePath)
    const ext = path.extname(publicFilePath).toLowerCase()
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    // 2. Try reading from backend/media/uploads
    const localMediaRoot = path.join(process.cwd(), 'backend', 'media', 'uploads')
    const localFilePath = path.join(localMediaRoot, ...filePathSegments)

    try {
      const fileBuffer = await fs.readFile(localFilePath)
      const ext = path.extname(localFilePath).toLowerCase()
      const contentType = MIME_TYPES[ext] || 'application/octet-stream'

      return new NextResponse(fileBuffer, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      })
    } catch {
      // 3. Fallback: proxy from Django backend
      const djangoOrigin = process.env.DJANGO_API_ORIGIN || 'http://127.0.0.1:8000'
      try {
        const backendUrl = `${djangoOrigin}/uploads/${relativePath}`
        const upstream = await fetch(backendUrl)
        if (upstream.ok) {
          const upstreamBuffer = await upstream.arrayBuffer()
          const contentType = upstream.headers.get('content-type') || 'application/octet-stream'
          return new NextResponse(upstreamBuffer, {
            headers: {
              'Content-Type': contentType,
              'Cache-Control': 'public, max-age=31536000, immutable',
            },
          })
        }
      } catch (err) {
        console.error('Failed to proxy upload from backend:', err)
      }

      return new NextResponse('File Not Found', { status: 404 })
    }
  }
}
