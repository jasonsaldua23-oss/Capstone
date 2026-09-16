'use client'

import { type Dispatch, type SetStateAction, type MutableRefObject } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { formatPodOverlayLines, type PodOverlaySnapshot } from '@/lib/pod-camera-overlay'
import { Camera } from 'lucide-react'
import { openCameraSettings } from './trip-detail-camera'
import type { getCameraPermissionSteps } from './trip-detail-camera'

/**
 * Proof-of-delivery capture: the live camera view with its GPS/address overlay, and the permission help dialog.
 */
export type PodCameraDialogsProps = {
  cameraError: string | null
  cameraGps: { latitude: number; longitude: number } | null
  cameraLocationError: string | null
  cameraOverlaySnapshot: PodOverlaySnapshot | null
  cameraPermissionHint: string
  cameraPermissionSteps: ReturnType<typeof getCameraPermissionSteps>
  captureFromCamera: () => void
  capturedCameraPhoto: string | null
  closeCameraCapture: () => void
  continueCapturedPhoto: () => Promise<void>
  isCameraAddressLoading: boolean
  isCameraLoading: boolean
  isCameraOpen: boolean
  isCameraPermissionDialogOpen: boolean
  openCameraCapture: () => void
  setCapturedCameraPhoto: Dispatch<SetStateAction<string | null>>
  setIsCameraPermissionDialogOpen: Dispatch<SetStateAction<boolean>>
  videoRef: MutableRefObject<HTMLVideoElement | null>
}

export function PodCameraDialogs({
  cameraError,
  cameraGps,
  cameraLocationError,
  cameraOverlaySnapshot,
  cameraPermissionHint,
  cameraPermissionSteps,
  captureFromCamera,
  capturedCameraPhoto,
  closeCameraCapture,
  continueCapturedPhoto,
  isCameraAddressLoading,
  isCameraLoading,
  isCameraOpen,
  isCameraPermissionDialogOpen,
  openCameraCapture,
  setCapturedCameraPhoto,
  setIsCameraPermissionDialogOpen,
  videoRef,
}: PodCameraDialogsProps) {
  return (
    <>
      <Dialog open={isCameraOpen} onOpenChange={(open) => { if (!open) closeCameraCapture() }}>
        <DialogContent className="max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white p-0 shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:max-w-md">
          <DialogHeader>
            <div className="border-b border-sky-100/80 bg-white/70 px-5 pb-3.5 pt-5 backdrop-blur">
              <DialogTitle className="text-[1.45rem] font-black tracking-[-0.02em] text-[#123a67]">Capture POD Photo</DialogTitle>
              <DialogDescription className="mt-1 text-sm text-[#4d6785]">
                Take a clear photo of the delivered package or recipient.
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="max-h-[calc(100dvh-10rem)] space-y-3 overflow-y-auto px-5 pb-5 pt-4">
            {capturedCameraPhoto ? (
              <>
                <img
                  src={capturedCameraPhoto}
                  alt="Captured POD"
                  className="max-h-[60dvh] w-full rounded-xl border border-sky-100 bg-black object-contain shadow-[0_10px_24px_rgba(15,23,42,0.10)]"
                />
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" className="h-11 rounded-xl border-sky-200 bg-white/85 font-semibold text-[#17365d] shadow-[0_8px_18px_rgba(15,23,42,0.08)] hover:bg-sky-50" onClick={() => setCapturedCameraPhoto(null)}>
                    Try Again
                  </Button>
                  <Button className="h-11 rounded-xl bg-[#0d61ad] font-semibold text-white shadow-[0_12px_24px_rgba(2,132,199,0.28)] hover:bg-[#0b579c]" onClick={() => void continueCapturedPhoto()}>
                    Continue
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div
                  className="relative w-full overflow-hidden rounded-xl border border-sky-100 bg-black shadow-[0_10px_24px_rgba(15,23,42,0.10)]"
                  // Fix: absolute camera content needs an explicit packaged-app height; aspect utilities may collapse in the WebView build.
                  style={{ height: 'clamp(18rem, 56dvh, 32rem)' }}
                >
                  <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-cover" />
                  {cameraOverlaySnapshot ? (
                    <div
                      className="absolute bottom-[3%] left-[3%] max-w-[90%] rounded-lg bg-black/45 px-[clamp(0.55rem,2.5vw,0.9rem)] py-[clamp(0.45rem,2vw,0.75rem)] text-[clamp(0.68rem,2.8vw,0.9rem)] font-semibold leading-[1.35] text-white"
                      style={{ textShadow: '0 1px 3px rgba(0,0,0,0.95)' }}
                      aria-live="polite"
                    >
                      {formatPodOverlayLines(cameraOverlaySnapshot).map((line, index) => (
                        <p key={`${index}-${line}`} className="break-words">{line}</p>
                      ))}
                    </div>
                  ) : (
                    <div className="absolute bottom-[3%] left-[3%] max-w-[90%] rounded-lg bg-black/55 px-3 py-2 text-xs font-semibold text-white">
                      Waiting for current GPS location...
                    </div>
                  )}
                </div>
                {isCameraLoading ? <p className="text-sm text-[#4d6785]">Opening camera...</p> : null}
                {cameraError ? <p className="text-sm text-red-600">{cameraError}</p> : null}
                {cameraLocationError ? <p className="text-sm text-red-600">GPS: {cameraLocationError}</p> : null}
                <Button className="h-11 rounded-xl bg-[#0d61ad] font-semibold text-white shadow-[0_12px_24px_rgba(2,132,199,0.28)] hover:bg-[#0b579c]" onClick={captureFromCamera} disabled={isCameraLoading || Boolean(cameraError) || !cameraGps || isCameraAddressLoading}>
                  Capture Photo
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isCameraPermissionDialogOpen} onOpenChange={setIsCameraPermissionDialogOpen}>
        <DialogContent className="max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white p-0 shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:max-w-md">
          <DialogHeader>
            <div className="border-b border-sky-100/80 bg-white/70 px-5 pb-3.5 pt-5 backdrop-blur">
              <DialogTitle className="text-[1.45rem] font-black tracking-[-0.02em] text-[#123a67]">Camera Permission Required</DialogTitle>
              <DialogDescription className="mt-1 text-sm text-[#4d6785]">
                Driver delivery proof requires live camera access. Enable camera permission in browser/app settings, then retry.
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="max-h-[calc(100dvh-10rem)] space-y-3 overflow-y-auto px-5 pb-5 pt-4">
            <p className="text-sm text-red-600">{cameraError || 'Camera permission is currently blocked.'}</p>
            {cameraPermissionHint ? <p className="text-xs text-[#4d6785]">{cameraPermissionHint}</p> : null}
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                className="h-11 rounded-xl border-sky-200 bg-white/85 font-semibold text-[#17365d] shadow-[0_8px_18px_rgba(15,23,42,0.08)] hover:bg-sky-50"
                onClick={() => {
                  openCameraSettings()
                }}
              >
                Try Open Settings
              </Button>
              <Button
                className="h-11 rounded-xl bg-[#0d61ad] font-semibold text-white shadow-[0_12px_24px_rgba(2,132,199,0.28)] hover:bg-[#0b579c]"
                onClick={() => {
                  setIsCameraPermissionDialogOpen(false)
                  window.setTimeout(() => {
                    openCameraCapture()
                  }, 120)
                }}
              >
                Retry Camera
              </Button>
            </div>
            <div className="rounded-xl border border-sky-100 bg-white/70 p-3">
              <p className="mb-2 text-xs font-semibold text-[#17365d]">Manual steps</p>
              <ol className="list-decimal space-y-1 pl-4 text-xs text-[#4d6785]">
                {cameraPermissionSteps.map((step, index) => (
                  <li key={`camera-step-${index}`}>{step}</li>
                ))}
              </ol>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
