import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getDefaultLoginPathForVariant, resolveAppVariant } from '@/lib/app-variant'
import { loginPathForPortal } from '@/lib/portal-scope'

export default function LoginIndexPage() {
  const variant = resolveAppVariant()
  if (variant !== 'all') {
    redirect(getDefaultLoginPathForVariant(variant))
  }

  // Security: with no public staff choices, skip the redundant one-card chooser
  // and send visitors directly to the existing Customer login page.
  redirect(loginPathForPortal('customer'))

  // Security: advertise only the public customer portal. Staff login routes stay
  // available through their direct URLs without being exposed in this chooser.
  const portals = [
    { href: loginPathForPortal('customer'), title: 'Customer', description: 'Shop, submit requests, and track orders.', accent: 'border-amber-200 hover:border-amber-500' },
  ]

  // The background URL below is deliberately unquoted. React escapes an apostrophe
  // to its HTML entity when rendering a className into markup, and Tailwind's source
  // scanner reads build output as well as source, so a quoted arbitrary url() can
  // come back as a rule pointing at a filename made of entities, which fails the
  // build with "Module not found". Leaving the URL bare removes the character that
  // gets escaped, so the class survives a round trip through rendered HTML.
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#eaf1f2] bg-[url(/customer-login-bg.png)] bg-cover bg-center px-4 py-10">
      <section className="w-full max-w-4xl rounded-3xl border border-white/80 bg-white/95 p-6 shadow-[0_22px_65px_rgba(15,23,42,0.16)] backdrop-blur sm:p-9">
        <div className="text-center">
          <img src="/ann-anns-logo.png" alt="Ann Ann's Beverages Trading logo" className="mx-auto h-24 w-24 object-contain" />
          <h1 className="mt-3 text-2xl font-extrabold text-[#112b60] sm:text-3xl">Ann Ann&apos;s Beverages Trading</h1>
          <p className="mt-2 text-sm text-slate-600 sm:text-base">Choose your account portal to continue.</p>
        </div>

        {/* The public chooser intentionally excludes staff portals. */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {portals.map((portal) => (
            <Link
              key={portal.href}
              href={portal.href}
              className={`rounded-2xl border-2 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${portal.accent}`}
            >
              <h2 className="text-lg font-bold text-slate-900">{portal.title}</h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">{portal.description}</p>
              <span className="mt-4 inline-flex text-sm font-semibold text-blue-700">Open portal →</span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  )
}
