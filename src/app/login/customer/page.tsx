import { redirect } from 'next/navigation'
import { CustomerLoginPage as CustomerLoginScreen } from '@/components/auth/CustomerLoginPage'
import { getAllowedPortals, getDefaultLoginPathForVariant, resolveAppVariant } from '@/lib/app-variant'

export default function CustomerLoginRoute() {
  const variant = resolveAppVariant()
  if (!getAllowedPortals(variant).includes('customer')) {
    redirect(getDefaultLoginPathForVariant(variant))
  }

  return <CustomerLoginScreen />
}
