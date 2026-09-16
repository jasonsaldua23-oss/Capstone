import { prepareImageForUpload } from '@/lib/client-image'
import { toast } from 'sonner'
import { isNativeCapacitorApp, openNativeAppSettings } from './trip-detail-helpers'
import { isAutomaticallyRetryableWriteStatus, waitForDriverWriteRetry } from './trip-detail-retry'

/**
 * Proof-of-delivery camera support: image conversion and upload, and the web/native camera permission handling.
 */

export const toDataUrl = async (file: File): Promise<string> => {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Failed to prepare damage photo'))
    reader.readAsDataURL(file)
  })
  if (!dataUrl) {
    throw new Error('Failed to prepare damage photo')
  }
  return dataUrl
}

export const uploadPodImage = async (file: File) => {
  const preparedFile = await prepareImageForUpload(file)
  for (let attempt = 0; ; attempt += 1) {
    try {
      const formData = new FormData()
      formData.append('file', preparedFile)
      const response = await fetch('/api/uploads/pod-image', {
        method: 'POST',
        body: formData,
      })
      const payload = await response.json().catch(() => ({}))
      if (response.ok && payload?.success !== false && payload?.imageUrl) {
        return String(payload.imageUrl)
      }

      const errorMessage = String(payload?.error || 'Failed to upload POD image')
      if (/upload storage is unavailable/i.test(errorMessage)) {
        toast('Storage is not configured on this deployment. The image will be saved inline for this record.')
        return toDataUrl(preparedFile)
      }
      if (!isAutomaticallyRetryableWriteStatus(response.status)) throw new Error(errorMessage)
    } catch (error) {
      if (error instanceof Error && error.message && !/failed to fetch|networkerror|load failed|network request failed/i.test(error.message)) throw error
    }
    // Keep the delivery confirmation loader active until a temporary POD upload succeeds.
    await waitForDriverWriteRetry(attempt)
  }
}

export const dataUrlToFile = (dataUrl: string, filename: string): File => {
  const [header, encoded] = dataUrl.split(',')
  if (!header || !encoded) {
    throw new Error('Invalid captured photo data')
  }
  const mimeMatch = header.match(/data:(.*?);base64/)
  const mimeType = mimeMatch?.[1] || 'image/jpeg'
  const binary = atob(encoded)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let index = 0; index < len; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new File([bytes], filename, { type: mimeType })
}

export const insecureCameraMessage = 'Camera requires a secure connection (HTTPS). Open this app over HTTPS to allow camera on mobile.'

export const getWebCameraPermissionState = async (): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> => {
  try {
    const permissionsApi = (navigator as any)?.permissions
    if (!permissionsApi?.query) return 'unknown'
    const result = await permissionsApi.query({ name: 'camera' as PermissionName })
    const state = String(result?.state || '').toLowerCase()
    if (state === 'granted' || state === 'denied' || state === 'prompt') {
      return state
    }
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

export const mapWebCameraErrorToMessage = (error: any) => {
  const errName = String(error?.name || '')
  const denied =
    errName === 'NotAllowedError' ||
    errName === 'PermissionDeniedError' ||
    errName === 'SecurityError'

  if (!window.isSecureContext) {
    return insecureCameraMessage
  }
  if (denied) {
    return 'Camera permission denied. Please enable camera access in browser/app settings.'
  }
  if (errName === 'NotFoundError') {
    return 'No camera device was found on this phone.'
  }
  if (errName === 'NotReadableError') {
    return 'Camera is busy in another app. Close other camera apps and retry.'
  }
  if (errName === 'TypeError') {
    return 'Camera is unavailable for this page. On mobile this is usually due to non-HTTPS access.'
  }
  if (errName === 'AbortError') {
    return 'Unable to start camera. Please retry.'
  }
  return 'Unable to access camera on this device/browser.'
}

export const ensureWebCameraPermission = async (): Promise<{ granted: boolean; reason?: string }> => {
  if (!window.isSecureContext) {
    return { granted: false, reason: insecureCameraMessage }
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return { granted: false, reason: 'This browser/device does not expose camera APIs for this page.' }
  }

  const permissionState = await getWebCameraPermissionState()
  if (permissionState === 'denied') {
    return { granted: false, reason: 'Camera permission denied. Please enable camera access in browser/app settings.' }
  }

  // Fix: the modal requests the real stream once; a second preflight stream made
  // mobile Safari initialize the camera twice before showing the preview.
  return { granted: true }
}

// Tries to deep-link users into OS/app settings to unblock camera permission.
export const openCameraSettings = async () => {
  if (isNativeCapacitorApp()) {
    const opened = await openNativeAppSettings()
    if (!opened) {
      toast.message('If settings did not open, follow the steps shown below.')
    }
    return
  }

  try {
    const ua = navigator.userAgent.toLowerCase()
    const isAndroid = ua.includes('android')
    const isIOS = ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')
    const isEdge = ua.includes('edg/')
    const isChrome = ua.includes('chrome') && !isEdge
    const isFirefox = ua.includes('firefox')

    if (!isAndroid && !isIOS) {
      if (isEdge) {
        window.location.href = 'edge://settings/content/camera'
        return
      }
      if (isChrome) {
        window.location.href = 'chrome://settings/content/camera'
        return
      }
      if (isFirefox) {
        window.open('about:preferences#privacy', '_blank')
        return
      }
    }

    if (ua.includes('android')) {
      window.location.href = 'intent://settings#Intent;scheme=android-app;package=com.android.settings;end'
      return
    }
    if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) {
      window.location.href = 'app-settings:'
      return
    }
    window.open('about:preferences#privacy', '_blank')
  } catch {
    // best effort only
  } finally {
    window.setTimeout(() => {
      toast.message('If settings did not open, follow the steps shown below.')
    }, 600)
  }
}

// Platform-specific permission recovery instructions shown in the dialog.
export const getCameraPermissionSteps = () => {
  if (isNativeCapacitorApp()) {
    return [
      'Open this app in system settings.',
      'Allow Camera permission for the app.',
      'Return to AnnDrive and tap Retry Camera.',
    ]
  }
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('android')) {
    return [
      'In browser, tap the lock icon near the address bar.',
      'Open Site settings/Permissions for this site.',
      'Set Camera to Allow.',
      'Return to this page and tap Retry Camera.',
    ]
  }
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) {
    return [
      'Open iPhone Settings.',
      'Find Safari (or your browser app).',
      'Enable Camera access for that browser.',
      'Return to this page and tap Retry Camera.',
    ]
  }
  if (ua.includes('edg/')) {
    return [
      'Open edge://settings/content/camera',
      'Allow camera globally and for this site.',
      'Reload this page and tap Retry Camera.',
    ]
  }
  if (ua.includes('chrome')) {
    return [
      'Open chrome://settings/content/camera',
      'Allow camera globally and for this site.',
      'Reload this page and tap Retry Camera.',
    ]
  }
  return [
    'Open browser/site settings for this page.',
    'Allow Camera permission for this site.',
    'Reload this page if needed.',
    'Tap Retry Camera.',
  ]
}
