import { redirect } from 'next/navigation'
import { getAllowedPortals, getDefaultLoginPathForVariant, resolveAppVariant } from '@/lib/app-variant'
import { loginPathForPortal } from '@/lib/portal-scope'

export default async function CustomerForgotPasswordRoute({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>
}) {
  const variant = resolveAppVariant()
  if (!getAllowedPortals(variant).includes('customer')) {
    redirect(getDefaultLoginPathForVariant(variant))
  }

  // Preserve old reset links while keeping the active flow inside Customer scope.
  const { email } = await searchParams
  const query = email ? `?email=${encodeURIComponent(email)}` : ''
  redirect(`${loginPathForPortal('customer')}/forgot-password${query}`)
}
