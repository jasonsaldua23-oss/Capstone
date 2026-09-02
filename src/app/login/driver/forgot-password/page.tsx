import { redirect } from 'next/navigation'
import { getAllowedPortals, getDefaultLoginPathForVariant, resolveAppVariant } from '@/lib/app-variant'
import { loginPathForPortal } from '@/lib/portal-scope'

export default async function DriverForgotPasswordRoute({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>
}) {
  const variant = resolveAppVariant()
  if (!getAllowedPortals(variant).includes('driver')) {
    redirect(getDefaultLoginPathForVariant(variant))
  }

  // Preserve old reset links while keeping the active flow inside Driver scope.
  const { email } = await searchParams
  const query = email ? `?email=${encodeURIComponent(email)}` : ''
  redirect(`${loginPathForPortal('driver')}/forgot-password${query}`)
}
