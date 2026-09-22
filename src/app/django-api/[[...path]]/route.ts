import { forwardDjangoApi } from '@/lib/django-api-proxy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Fix: keep every API method on the same authenticated, streaming forwarding path.
async function proxy(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await context.params
  return forwardDjangoApi(request, path, process.env.DJANGO_API_ORIGIN?.trim() || 'http://127.0.0.1:8000')
}

export { proxy as GET, proxy as HEAD, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE, proxy as OPTIONS }
