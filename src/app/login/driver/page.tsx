import { redirect } from 'next/navigation'
import { getAllowedPortals, getDefaultLoginPathForVariant, resolveAppVariant } from '@/lib/app-variant'
import { loginPathForPortal } from '@/lib/portal-scope'

export default function DriverLoginRoute() {
  const variant = resolveAppVariant()
  if (!getAllowedPortals(variant).includes('driver')) {
    redirect(getDefaultLoginPathForVariant(variant))
  }

  // Preserve old bookmarks while moving the installable app into its own scope.
  redirect(loginPathForPortal('driver'))
}
