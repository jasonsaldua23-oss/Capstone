'use client'

// Without this file an uncaught render error anywhere outside PortalErrorBoundary
// (the auth flow, layout chrome, a route transition) unmounts the tree and leaves a
// blank white page with nothing to click. This catches those and offers a way back.

import { useEffect } from 'react'

const CHUNK_RELOAD_KEY = 'aab:chunk-reload-at'
const CHUNK_RELOAD_WINDOW_MS = 30_000

function isChunkLoadError(error: unknown) {
  const text = `${(error as Error)?.name || ''} ${(error as Error)?.message || ''}`
  return /ChunkLoadError|Loading chunk|Loading CSS chunk|dynamically imported module|Importing a module script failed/i.test(text)
}

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // Derived in render, not stored: the buttons must stay available even when the
  // one-time auto reload is suppressed, so a stale-chunk error is never a dead end.
  const staleBuild = isChunkLoadError(error)

  useEffect(() => {
    console.error('Route error:', error)

    // A tab left open across a deploy requests JS chunks that no longer exist, which
    // is one of the most common ways this app goes white. Reloading pulls the new
    // build - but only once, so a genuinely broken build cannot loop forever.
    if (!isChunkLoadError(error) || typeof window === 'undefined') return
    try {
      const last = Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0)
      if (Date.now() - last < CHUNK_RELOAD_WINDOW_MS) return
      window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()))
    } catch {
      // Private mode or blocked storage: fall through to the manual buttons.
      return
    }
    window.location.reload()
  }, [error])

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-xl p-6 shadow-xl text-center">
        <h2 className="text-xl font-semibold mb-2">
          {staleBuild ? 'A new version is available' : 'Something went wrong'}
        </h2>
        <p className="text-sm text-gray-600 mb-5">
          {staleBuild
            ? 'This page was open while a new version was released. Reload to pick it up.'
            : 'The page hit an unexpected error. Your data was not lost - try again, or reload the page.'}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            onClick={() => window.location.reload()}
            type="button"
            className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            Reload page
          </button>
          <button
            onClick={reset}
            type="button"
            className="inline-flex items-center justify-center rounded-md border border-slate-300 px-4 py-2 text-slate-700 hover:bg-slate-50"
          >
            Try again
          </button>
        </div>
        {error?.digest ? (
          <p className="mt-4 text-[11px] text-gray-400">Reference: {error.digest}</p>
        ) : null}
      </div>
    </div>
  )
}
