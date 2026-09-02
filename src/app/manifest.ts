import type { MetadataRoute } from 'next'

import { getDefaultPortalForVariant, resolveAppVariant } from '@/lib/app-variant'

/**
 * The web app manifest that makes a portal installable.
 *
 * Each deployment builds for one portal (`NEXT_PUBLIC_APP_VARIANT`), so the manifest
 * describes that portal specifically - its own name, icon and start page - and a
 * device that installs the Driver portal does not land in the Shop.
 */

const portalManifest = {
  driver: {
    name: "Ann Ann's Beverages Trading Driver",
    short_name: 'AAB Driver',
    description: 'Trips, deliveries and proof of delivery for Ann Ann’s Beverages Trading drivers.',
    start_url: '/login/driver',
    theme_color: '#16984e',
    icon: '/aab-trading-driver.png',
  },
  customer: {
    name: "Ann Ann's Beverages Trading Shop",
    short_name: 'AAB Shop',
    description: 'Order beverages and track deliveries from Ann Ann’s Beverages Trading.',
    start_url: '/login/customer',
    theme_color: '#3ca232',
    icon: '/aab-trading-shop.png',
  },
  admin: {
    name: "Ann Ann's Beverages Trading Admin",
    short_name: 'AAB Admin',
    description: 'Operations, inventory and reporting for Ann Ann’s Beverages Trading.',
    start_url: '/login/admin',
    theme_color: '#0f4fd3',
    icon: '/ann-anns-logo.png',
  },
  warehouse: {
    name: "Ann Ann's Beverages Trading Warehouse",
    short_name: 'AAB Warehouse',
    description: 'Stock, loading and dispatch for Ann Ann’s Beverages Trading warehouse staff.',
    start_url: '/login/warehouse',
    theme_color: '#0f4fd3',
    icon: '/ann-anns-logo.png',
  },
} as const

export default function manifest(): MetadataRoute.Manifest {
  const variant = resolveAppVariant()
  // A shared deployment exposes every portal, so it installs as the chooser.
  const portal = variant === 'all' ? 'customer' : getDefaultPortalForVariant(variant)
  const entry = portalManifest[portal as keyof typeof portalManifest] || portalManifest.customer

  return {
    name: entry.name,
    short_name: entry.short_name,
    description: entry.description,
    id: `/?portal=${portal}`,
    start_url: entry.start_url,
    scope: '/',
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
