'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

const defaults = { orderUpdates: true, tripNotifications: true, deliveryUpdates: true, systemAlerts: true }

// Persist real account choices; a switch changes only after the server confirms its save.
export function useNotificationPreferences(accountId: string | undefined, portal: 'customer' | 'driver') {
  const [preferences, setPreferences] = useState(defaults)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const busyRef = useRef(false)
  const generationRef = useRef(0)

  const reload = useCallback(async () => {
    const generation = ++generationRef.current
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/notifications/preferences', { cache: 'no-store', headers: { 'X-Portal': portal } })
      const data = await response.json()
      if (!response.ok || !data.success || !data.preferences) throw new Error(data.error || 'Unable to load notification settings')
      if (generation === generationRef.current) setPreferences({ ...defaults, ...data.preferences })
    } catch (failure) {
      if (generation === generationRef.current) setError(failure instanceof Error ? failure.message : 'Unable to load notification settings')
    } finally {
      if (generation === generationRef.current) setLoading(false)
    }
  }, [accountId, portal])

  useEffect(() => {
    void reload()
    return () => { generationRef.current += 1 }
  }, [reload])

  const save = async (next: Partial<typeof defaults>) => {
    if (loading || error || busyRef.current) return
    const keys = portal === 'customer' ? ['orderUpdates', 'deliveryUpdates'] as const : ['tripNotifications', 'deliveryUpdates'] as const
    const changes = Object.fromEntries(keys.filter((key) => next[key] !== undefined && next[key] !== preferences[key]).map((key) => [key, next[key]]))
    if (!Object.keys(changes).length) return
    busyRef.current = true
    setSaving(true)
    const generation = generationRef.current
    try {
      const response = await fetch('/api/notifications/preferences', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Portal': portal }, body: JSON.stringify(changes),
      })
      const data = await response.json()
      if (!response.ok || !data.success || !data.preferences) throw new Error(data.error || 'Unable to save notification settings')
      if (generation === generationRef.current) setPreferences({ ...defaults, ...data.preferences })
    } catch (failure) {
      if (generation === generationRef.current) toast.error(failure instanceof Error ? failure.message : 'Unable to save notification settings')
    } finally {
      busyRef.current = false
      setSaving(false)
    }
  }

  return { preferences, save, disabled: loading || saving || Boolean(error), error, reload }
}
