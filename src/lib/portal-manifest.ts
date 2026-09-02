/**
 * The installable app each portal describes.
 *
 * A browser will only ever offer to install what the page's manifest declares, and
 * it treats one manifest `id` as one app. The shared deployment serves all four
 * portals from a single origin, so a single site-wide manifest meant the browser
 * knew about exactly one installable app - the Shop - and a driver was never
 * offered anything, because the Shop identity had already been offered or
 * installed. Each portal therefore gets its own manifest, and its own identity.
 *
 * `id` must stay stable: it is how a browser recognises an already-installed app,
 * so changing it would orphan the copies people have on their phones.
 */

import type { MetadataRoute } from 'next'

import { getDefaultPortalForVariant, resolveAppVariant } from '@/lib/app-variant'

export type ManifestPortal = 'driver' | 'customer' | 'admin' | 'warehouse'

export const MANIFEST_PORTALS: ManifestPortal[] = ['driver', 'customer', 'admin', 'warehouse']

const portalManifest = {
  driver: {
    name: "Ann Ann's Beverages Trading Driver",
    short_name: 'AAB Driver',
    description: 'Trips, deliveries and proof of delivery for Ann Ann’s Beverages Trading drivers.',
    start_url: '/driver',
    scope: '/driver',
    theme_color: '#16984e',
    icon: '/aab-trading-driver.png',
  },
  customer: {
    name: "Ann Ann's Beverages Trading Shop",
    short_name: 'AAB Shop',
    description: 'Order beverages and track deliveries from Ann Ann’s Beverages Trading.',
    start_url: '/customer',
    scope: '/customer',
    theme_color: '#3ca232',
    icon: '/aab-trading-shop.png',
  },
  admin: {
    name: "Ann Ann's Beverages Trading Admin",
    short_name: 'AAB Admin',
    description: 'Operations, inventory and reporting for Ann Ann’s Beverages Trading.',
    start_url: '/login/admin',
    scope: '/',
    theme_color: '#0f4fd3',
    icon: '/ann-anns-logo.png',
  },
  warehouse: {
    name: "Ann Ann's Beverages Trading Warehouse",
    short_name: 'AAB Warehouse',
    description: 'Stock, loading and dispatch for Ann Ann’s Beverages Trading warehouse staff.',
    start_url: '/login/warehouse',
    scope: '/',
    theme_color: '#0f4fd3',
    icon: '/ann-anns-logo.png',
  },
} as const

export function isManifestPortal(value: string): value is ManifestPortal {
  return (MANIFEST_PORTALS as string[]).includes(value)
}

/** The URL the portal's own manifest is served from. */
export function manifestPathForPortal(portal: ManifestPortal): string {
  return `/manifest/${portal}.webmanifest`
}

export function buildPortalManifest(portal: ManifestPortal): MetadataRoute.Manifest {
  const entry = portalManifest[portal]

  return {
    name: entry.name,
    short_name: entry.short_name,
    description: entry.description,
    id: `/?portal=${portal}`,
    start_url: entry.start_url,
    // Fix: Driver and Customer must not both control every URL on the origin.
    // Their distinct prefixes stop one installed app capturing the other's links.
    scope: entry.scope,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: entry.theme_color,
    icons: [
      { src: entry.icon, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: entry.icon, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: entry.icon, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}

/**
 * The portal the single site-wide manifest describes.
 *
 * The shared deployment serves every portal and so has no one answer; it falls
 * back to the Shop. Any portal other than this one is a different installable app
 * from the one the document was served with, which is what the portal shell has to
 * know before it swaps the manifest link.
 */
export function siteWideManifestPortal(): ManifestPortal {
  const variant = resolveAppVariant()
  if (variant === 'all') return 'customer'
  const portal = getDefaultPortalForVariant(variant)
  return isManifestPortal(portal) ? portal : 'customer'
}
