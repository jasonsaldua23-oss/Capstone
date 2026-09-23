import { redirect } from 'next/navigation'
import { CustomerLoginPage as CustomerRegistrationScreen } from '@/components/auth/CustomerLoginPage'
import { SystemLoginPage } from '@/components/auth/StaffLoginPage'
import { getDefaultLoginPathForVariant, resolveAppVariant } from '@/lib/app-variant'

type LoginIndexPageProps = {
  searchParams: Promise<{ mode?: string }>
}

export default async function LoginIndexPage({ searchParams }: LoginIndexPageProps) {
  const variant = resolveAppVariant()
  if (variant !== 'all') {
    redirect(getDefaultLoginPathForVariant(variant))
  }

  const { mode } = await searchParams
  if (mode === 'register') {
    // Browser registration stays on the neutral /login URL; the native Shop route
    // continues to render this same form from its own /customer/login scope.
    return (
      <CustomerRegistrationScreen initialAuthMode="register" loginHref="/login" />
    )
  }

  // The shared browser sign-in deliberately does not ask visitors to pick a role.
  // The authenticated account selects its destination, registration, and recovery flow.
  return (
    <SystemLoginPage
      entryPortal="customer"
      registrationHref="/login?mode=register"
      forgotPasswordPath="/login/forgot-password"
      restorePortal={null}
    />
  )
}
