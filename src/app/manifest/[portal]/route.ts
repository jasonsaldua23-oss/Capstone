import { NextResponse } from 'next/server'

import { MANIFEST_PORTALS, buildPortalManifest, isManifestPortal } from '@/lib/portal-manifest'

/**
 * One manifest per portal, so each portal is its own installable app.
 *
 * Next's `manifest.ts` convention can only produce a single site-wide manifest,
 * which is why this is a route: the shared deployment needs four, and each login
 * page points at its own through the page's `manifest` metadata.
 */
export function generateStaticParams() {
  return MANIFEST_PORTALS.map((portal) => ({ portal: `${portal}.webmanifest` }))
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ portal: string }> },
) {
  const resolvedParams = await params
  const portal = resolvedParams.portal.replace(/\.webmanifest$/, '')

  if (!isManifestPortal(portal)) {
    return NextResponse.json({ error: 'Unknown portal' }, { status: 404 })
  }

  return NextResponse.json(buildPortalManifest(portal), {
    headers: {
      'Content-Type': 'application/manifest+json',
      // Fix: installed apps must revalidate scope changes instead of retaining a
      // cached root scope that can keep capturing the other portal's URLs.
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  })
}
