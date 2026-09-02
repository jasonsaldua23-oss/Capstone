import type { MetadataRoute } from 'next'

import { buildPortalManifest, siteWideManifestPortal } from '@/lib/portal-manifest'

/**
 * The site-wide manifest, used where no portal is known yet.
 *
 * A single-portal deployment describes that portal. The shared deployment has no
 * one answer, so it falls back to the Shop - but every portal also serves its own
 * manifest at /manifest/<portal>.webmanifest, and the login pages and the portal
 * shell point at those, which is what makes each portal separately installable.
 */
export default function manifest(): MetadataRoute.Manifest {
  return buildPortalManifest(siteWideManifestPortal())
}
