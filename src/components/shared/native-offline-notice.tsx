'use client'

import { useNativeOffline } from '@/hooks/use-native-offline'

export function NativeOfflineNotice() {
  const offline = useNativeOffline()
  if (!offline) return null

  // Keep the notice in the layout below the header, without covering app controls.
  return (
    <div role="status" className="shrink-0 bg-white px-3 py-2 text-center text-xs font-semibold text-[#ff4d35]">
      No Internet Connection
    </div>
  )
}
