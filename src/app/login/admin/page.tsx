import { redirect } from 'next/navigation'
import { AdminLoginPage as AdminLoginScreen } from '@/components/auth/AdminLoginPage'
import { getAllowedPortals, getDefaultLoginPathForVariant, resolveAppVariant } from '@/lib/app-variant'

export default function AdminLoginRoute() {
  const variant = resolveAppVariant()
  if (!getAllowedPortals(variant).includes('admin')) {
    redirect(getDefaultLoginPathForVariant(variant))
  }

  return <AdminLoginScreen />
}
