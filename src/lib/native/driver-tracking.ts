import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { trackingCredentialsChanged, type TrackingConfig } from './driver-tracking-policy'
import { isPluginAvailable, waitForNativeBridge } from './platform'

export type NativeDriverFix = {
  driverId?: string
  lat: number; lng: number; accuracy: number | null; heading: number | null; speed: number | null; recordedAt: number
}
type TrackingStatus = { running: boolean; driverId: string; location: NativeDriverFix | null; error: string | null }
interface DriverTrackingPlugin {
  start(config: TrackingConfig): Promise<void>
  stop(): Promise<void>
  getStatus(): Promise<TrackingStatus>
  addListener(event: 'location', listener: (location: NativeDriverFix) => void): Promise<PluginListenerHandle>
  addListener(event: 'status', listener: (status: TrackingStatus) => void): Promise<PluginListenerHandle>
}
const DriverTracking = registerPlugin<DriverTrackingPlugin>('DriverTracking')

export async function hasNativeDriverTracking() {
  await waitForNativeBridge()
  return isPluginAvailable('DriverTracking')
}

export async function startNativeDriverTracking(
  config: () => TrackingConfig,
  onLocation: (fix: NativeDriverFix) => void,
  onStatus: (status: TrackingStatus) => void,
) {
  let stopped = false
  // The session the service currently holds; every start() resets its upload backoff.
  let handedOff: TrackingConfig | null = null
  const listeners: PluginListenerHandle[] = []
  const status = (value: TrackingStatus) => {
    if (stopped || (value.driverId && value.driverId !== config().driverId)) return
    if (value.location) onLocation(value.location)
    onStatus(value)
  }
  const start = async (next: TrackingConfig) => {
    await DriverTracking.start(next)
    handedOff = next
  }
  try {
    listeners.push(await DriverTracking.addListener('location', (fix) => {
      if (!stopped && (!fix.driverId || fix.driverId === config().driverId)) onLocation(fix)
    }))
    listeners.push(await DriverTracking.addListener('status', status))
    await start(config())
    status(await DriverTracking.getStatus())
  } catch (error) {
    await Promise.all(listeners.map((listener) => listener.remove()))
    throw error
  }
  return {
    // Native uploads never depend on this callback. It only reconciles the resumed UI with native GPS.
    refresh: async () => {
      if (stopped) return
      await start(config())
      if (!stopped) status(await DriverTracking.getStatus())
    },
    // For a credential failure reported by the service: hand over the session only
    // if it actually changed. Re-sending the same one would just reset the backoff
    // and retry the same rejected upload immediately.
    refreshIfCredentialsChanged: async () => {
      if (stopped) return false
      const next = config()
      if (!trackingCredentialsChanged(handedOff, next)) return false
      await start(next)
      if (!stopped) status(await DriverTracking.getStatus())
      return true
    },
    clear: async () => {
      if (stopped) return
      stopped = true
      await Promise.all(listeners.map((listener) => listener.remove()))
      await DriverTracking.stop()
    },
  }
}
