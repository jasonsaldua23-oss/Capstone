import { CheckCircle2, Loader2 } from 'lucide-react'

// Shared transition feedback stays visible while the authenticated portal opens.
export function LoginSuccess() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-slate-50 px-4">
      <div className="text-center" role="status" aria-live="polite">
        <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-emerald-600" aria-hidden="true" />
        <h1 className="text-xl font-semibold text-slate-900">Login successful!</h1>
        <p className="mt-2 flex items-center justify-center gap-2 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Opening your portal…
        </p>
      </div>
    </div>
  )
}
