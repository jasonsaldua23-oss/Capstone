import { redirect } from 'next/navigation'
import { getAllowedPortals, getDefaultLoginPathForVariant, resolveAppVariant } from '@/lib/app-variant'
import { loginPathForPortal } from '@/lib/portal-scope'

export default function CustomerLoginRoute() {
  const variant = resolveAppVariant()
  if (!getAllowedPortals(variant).includes('customer')) {
    redirect(getDefaultLoginPathForVariant(variant))
  }

  // Preserve old bookmarks while moving the installable app into its own scope.
  redirect(loginPathForPortal('customer'))
}
