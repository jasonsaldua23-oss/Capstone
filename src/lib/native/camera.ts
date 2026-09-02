/**
 * Taking a photo, wherever the portal is running.
 *
 * Inside the app this opens the OS camera through Capacitor, which produces a
 * better picture than a WebView `getUserMedia` stream and survives the app being
 * backgrounded mid-capture. In a browser there is no equivalent, so callers fall
 * back to the file input they already have - `openNativeCamera` returns null and
 * the existing `<input type="file" accept="image/*" capture>` takes over.
 *
 * The driver's proof-of-delivery screen keeps its own live preview: it stamps GPS,
 * time and driver name onto the frame, which needs the raw video element.
 */

import { isNativeApp, isPluginAvailable } from './platform'
import { ensureCameraPermission, type PermissionOutcome } from './permissions'

export type CapturedPhoto = {
  file: File
  dataUrl: string
}

export class CameraUnavailableError extends Error {
  readonly blocked: boolean
  constructor(message: string, blocked = false) {
    super(message)
    this.name = 'CameraUnavailableError'
    this.blocked = blocked
  }
}

export async function requestCameraAccess(): Promise<PermissionOutcome> {
  return ensureCameraPermission()
}

/** True when a photo can be taken without falling back to a file picker. */
export function canUseNativeCamera(): boolean {
  return isNativeApp() && isPluginAvailable('Camera')
}

function dataUrlToFile(dataUrl: string, fileName: string): File {
  const [header, encoded] = dataUrl.split(',')
  const mime = /data:(.*?);/.exec(header)?.[1] || 'image/jpeg'
  const binary = atob(encoded || '')
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new File([bytes], fileName, { type: mime })
}

/**
 * Open the device camera and return the photo, or null when this runtime has no
 * native camera and the caller should use its existing file input.
 *
 * Throws `CameraUnavailableError` only when the native camera exists but cannot be
 * used - a denied permission, or a failure inside the plugin. A cancelled capture
 * resolves to null, because backing out is not an error.
 */
export async function openNativeCamera(
  options: { fileName?: string; quality?: number; allowGallery?: boolean } = {},
): Promise<CapturedPhoto | null> {
  if (!canUseNativeCamera()) return null

  const permission = await ensureCameraPermission()
  if (!permission.granted) {
    throw new CameraUnavailableError(permission.message, permission.blocked)
  }

  try {
    const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera')
    const photo = await Camera.getPhoto({
      quality: options.quality ?? 80,
      allowEditing: false,
      resultType: CameraResultType.DataUrl,
      source: options.allowGallery ? CameraSource.Prompt : CameraSource.Camera,
      correctOrientation: true,
      saveToGallery: false,
    })
    if (!photo?.dataUrl) return null
    const extension = String(photo.format || 'jpeg').toLowerCase()
    const fileName = options.fileName || `photo-${Date.now()}.${extension === 'jpg' ? 'jpg' : extension}`
    return { file: dataUrlToFile(photo.dataUrl, fileName), dataUrl: photo.dataUrl }
  } catch (error) {
    const message = String((error as Error)?.message || '').toLowerCase()
    // The plugin reports a dismissed camera as an error; that is a cancel, not a fault.
    if (message.includes('cancel') || message.includes('dismiss') || message.includes('no image')) {
      return null
    }
    throw new CameraUnavailableError(
      'The camera could not be opened. Check that camera access is allowed for this app.',
    )
  }
}
