import { redirect } from 'next/navigation'
import { getDefaultLoginPathForVariant, resolveAppVariant } from '@/lib/app-variant'

export default function LoginIndexPage() {
  redirect(getDefaultLoginPathForVariant(resolveAppVariant()))
}
