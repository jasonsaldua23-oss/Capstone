'use client'

// The last line of defence. error.tsx cannot catch a failure in the root layout
// itself; without this file such a failure renders nothing at all. It must supply its
// own <html>/<body> because the broken layout never rendered them.

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Global error:', error)
  }, [error])

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif', background: '#0f172a' }}>
        <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '1rem' }}>
          <div style={{ maxWidth: '28rem', width: '100%', background: '#fff', borderRadius: '0.75rem', padding: '1.5rem', textAlign: 'center' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: '0 0 0.5rem' }}>
              The app failed to start
            </h2>
            <p style={{ fontSize: '0.875rem', color: '#4b5563', margin: '0 0 1.25rem' }}>
              Something went wrong before the page could load. Reloading usually fixes it.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={reset}
                type="button"
                style={{ background: '#2563eb', color: '#fff', border: 0, borderRadius: '0.375rem', padding: '0.5rem 1rem', cursor: 'pointer' }}
              >
                Try again
              </button>
              <button
                onClick={() => window.location.reload()}
                type="button"
                style={{ background: '#fff', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '0.375rem', padding: '0.5rem 1rem', cursor: 'pointer' }}
              >
                Reload page
              </button>
            </div>
            {error?.digest ? (
              <p style={{ marginTop: '1rem', fontSize: '0.6875rem', color: '#9ca3af' }}>
                Reference: {error.digest}
              </p>
            ) : null}
          </div>
        </div>
      </body>
    </html>
  )
}
