import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { isPluginAvailable, waitForNativeBridge } from './platform'

export type NativeDriverFix = {
  driverId?: string
  lat: number; lng: number; accuracy: number | null; heading: number | null; speed: number | null; recordedAt: number
}
type TrackingStatus = { running: boolean; driverId: string; location: NativeDriverFix | null; error: string | null }
type TrackingConfig = { driverId: string; token: string; tripId: string }
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
  const listeners: PluginListenerHandle[] = []
  const status = (value: TrackingStatus) => {
    if (stopped || (value.driverId && value.driverId !== config().driverId)) return
    if (value.location) onLocation(value.location)
    onStatus(value)
  }
  try {
    listeners.push(await DriverTracking.addListener('location', (fix) => {
      if (!stopped && (!fix.driverId || fix.driverId === config().driverId)) onLocation(fix)
    }))
    listeners.push(await DriverTracking.addListener('status', status))
    await DriverTracking.start(config())
    status(await DriverTracking.getStatus())
  } catch (error) {
    await Promise.all(listeners.map((listener) => listener.remove()))
    throw error
  }
  return {
    // Native uploads never depend on this callback. It only reconciles the resumed UI with native GPS.
    refresh: async () => {
      if (stopped) return
      await DriverTracking.start(config())
      if (!stopped) status(await DriverTracking.getStatus())
    },
    clear: async () => {
      if (stopped) return
      stopped = true
      await Promise.all(listeners.map((listener) => listener.remove()))
      await DriverTracking.stop()
    },
  }
}
