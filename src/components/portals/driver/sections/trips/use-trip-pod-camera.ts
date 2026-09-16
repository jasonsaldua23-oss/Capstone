import { useEffect, useMemo, useRef, useState } from 'react'
import { burnPodOverlay, type PodOverlaySnapshot } from '@/lib/pod-camera-overlay'
import type { AuthUser } from '@/types'
import { toast } from 'sonner'
import { checkNativeCameraPermission, DropPoint, isNativeCapacitorApp, stripPhilippinesFromAddress } from './trip-detail-helpers'
import { haversineKm } from './trip-route-geometry'
import { dataUrlToFile, insecureCameraMessage, mapWebCameraErrorToMessage, ensureWebCameraPermission, getCameraPermissionSteps } from './trip-detail-camera'

/**
 * Proof-of-delivery capture state for a trip: per-stop photo drafts, the live camera stream and permission flow, and the GPS/address overlay stamped onto the photo.
 */
export type TripPodCameraInputs = {
  activeDropPoint: DropPoint | null
  driverUser: AuthUser | null
}

export function useTripPodCamera(inputs: TripPodCameraInputs) {
  const {
    activeDropPoint,
    driverUser,
  } = inputs

  const [podDraftByDropPoint, setPodDraftByDropPoint] = useState<Record<string, { file: File | null; preview: string | null }>>({})
  const [podCaptureDropPointId, setPodCaptureDropPointId] = useState<string | null>(null)
  const [isCameraOpen, setIsCameraOpen] = useState(false)
  const [capturedCameraPhoto, setCapturedCameraPhoto] = useState<string | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [isCameraLoading, setIsCameraLoading] = useState(false)
  const [isCameraPermissionDialogOpen, setIsCameraPermissionDialogOpen] = useState(false)
  const [cameraPermissionHint, setCameraPermissionHint] = useState<string>('')
  const [cameraNow, setCameraNow] = useState(() => new Date())
  const [cameraGps, setCameraGps] = useState<{ latitude: number; longitude: number } | null>(null)
  // Fix: keep the address lookup location stable while live GPS coordinates jitter.
  const [cameraAddressGps, setCameraAddressGps] = useState<{ latitude: number; longitude: number } | null>(null)
  const [cameraAddress, setCameraAddress] = useState('Resolving current address...')
  const [isCameraAddressLoading, setIsCameraAddressLoading] = useState(true)
  const [cameraLocationError, setCameraLocationError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const cameraGpsRef = useRef<{ latitude: number; longitude: number } | null>(null)
  const driverFullName = useMemo(() => {
    const profileName = [driverUser?.firstName, driverUser?.middleName, driverUser?.lastName, driverUser?.suffix]
      .map((part) => String(part || '').trim())
      .filter(Boolean)
      .join(' ')
    return profileName || String(driverUser?.name || 'Driver').trim() || 'Driver'
  }, [driverUser])
  const cameraOverlaySnapshot: PodOverlaySnapshot | null = cameraGps ? {
    capturedAt: cameraNow,
    driverName: driverFullName,
    address: cameraAddress,
    latitude: cameraGps.latitude,
    longitude: cameraGps.longitude,
  } : null
  const setPodFileForDropPoint = (dropPointId: string, file: File | null) => {
    const normalizedId = String(dropPointId || '').trim()
    if (!normalizedId) return
    setPodDraftByDropPoint((previous) => {
      const previousPreview = previous[normalizedId]?.preview
      if (previousPreview) URL.revokeObjectURL(previousPreview)
      if (!file) {
        const next = { ...previous }
        delete next[normalizedId]
        return next
      }
      return {
        ...previous,
        [normalizedId]: {
          file,
          preview: URL.createObjectURL(file),
        },
      }
    })
  }

  const openPodCameraCapture = (dropPointId: string) => {
    const normalizedId = String(dropPointId || '').trim()
    if (!normalizedId) return
    setPodCaptureDropPointId(normalizedId)
    openCameraCapture()
  }
  const handlePodFileChange = (dropPointId: string, file: File | null) => {
    setPodFileForDropPoint(dropPointId, file)
  }

  const attachCameraStreamToVideo = async () => {
    const stream = cameraStreamRef.current
    const video = videoRef.current
    if (!stream || !video) return

    if (video.srcObject !== stream) {
      video.srcObject = stream
    }
    await video.play().catch(() => { })
  }

  // Stops active camera tracks to release device resources immediately.
  const stopCameraStream = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop())
      cameraStreamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }

  // Opens camera flow and requests permission when needed.
  const openCameraCapture = () => {
    if (isNativeCapacitorApp()) {
      setCapturedCameraPhoto(null)
      setCameraError(null)
      setCameraPermissionHint('')
      void (async () => {
        try {
          const permission = await checkNativeCameraPermission()
          if (!permission.granted) {
            handleCameraPermissionDenied(permission.reason)
            return
          }
          // Fix: keep the camera inside the portal so the live POD overlay stays visible.
          setIsCameraOpen(true)
        } catch (error: any) {
          const message = String(error?.message || '')
          if (/cancelled|canceled|user cancelled|user canceled/i.test(message)) {
            return
          }
          handleCameraPermissionDenied(message || 'Unable to access camera on this device.')
        }
      })()
      return
    }

    void (async () => {
      const permission = await ensureWebCameraPermission()
      if (!permission.granted) {
        handleCameraPermissionDenied(permission.reason)
        return
      }

      setCapturedCameraPhoto(null)
      setCameraError(null)
      setCameraPermissionHint('')
      setIsCameraOpen(true)
    })()
  }
  const closeCameraCapture = () => {
    stopCameraStream()
    setIsCameraOpen(false)
    setIsCameraLoading(false)
    setCapturedCameraPhoto(null)
    setCameraGps(null)
    setCameraAddressGps(null)
    cameraGpsRef.current = null
    setCameraLocationError(null)
    setCameraAddress('Resolving current address...')
    setIsCameraAddressLoading(true)
  }

  // Central permission-denied handler to show actionable hints.
  const handleCameraPermissionDenied = (message?: string) => {
    closeCameraCapture()
    setCameraError(message || 'Camera access is required for POD. Please allow camera permission.')
    setCameraPermissionHint(message || '')
    setIsCameraPermissionDialogOpen(true)
    toast.error('Camera permission is required to complete delivery')
  }

  // Captures a still frame from video stream for POD evidence.
  const captureFromCamera = () => {
    const video = videoRef.current
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      toast.error('Camera is not ready yet')
      return
    }

    const gps = cameraGpsRef.current
    if (!gps) {
      toast.error('Waiting for your current GPS location')
      return
    }
    const snapshot: PodOverlaySnapshot = {
      capturedAt: new Date(),
      driverName: driverFullName,
      address: cameraAddress,
      latitude: gps.latitude,
      longitude: gps.longitude,
    }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) {
      toast.error('Failed to capture photo')
      return
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    // Added: the information shown in the preview becomes permanent image pixels.
    burnPodOverlay(context, canvas.width, canvas.height, snapshot)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    setCapturedCameraPhoto(dataUrl)
  }

  const continueCapturedPhoto = async () => {
    if (!capturedCameraPhoto) return
    try {
      const file = dataUrlToFile(capturedCameraPhoto, `camera-${Date.now()}.jpg`)
      const targetDropPointId = String(podCaptureDropPointId || activeDropPoint?.id || '').trim()
      if (!targetDropPointId) {
        toast.error('Select a drop point first before capturing POD')
        return
      }
      handlePodFileChange(targetDropPointId, file)
      closeCameraCapture()
    } catch {
      toast.error('Failed to use captured photo')
    }
  }
  useEffect(() => {
    return () => {
      Object.values(podDraftByDropPoint).forEach((entry) => {
        if (entry?.preview) URL.revokeObjectURL(entry.preview)
      })
      stopCameraStream()
    }
  }, [podDraftByDropPoint])

  useEffect(() => {
    if (!isCameraOpen) return

    let mounted = true
    const startCamera = async () => {
      setIsCameraLoading(true)
      setCameraError(null)
      try {
        if (!window.isSecureContext && !isNativeCapacitorApp()) {
          handleCameraPermissionDenied(insecureCameraMessage)
          return
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          handleCameraPermissionDenied('This browser/device does not expose camera APIs for this page.')
          return
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        })
        if (!mounted) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        cameraStreamRef.current = stream
        await attachCameraStreamToVideo()
      } catch (error: any) {
        handleCameraPermissionDenied(mapWebCameraErrorToMessage(error))
      } finally {
        if (mounted) {
          setIsCameraLoading(false)
        }
      }
    }

    void startCamera()

    return () => {
      mounted = false
      stopCameraStream()
    }
  }, [isCameraOpen])

  useEffect(() => {
    if (!isCameraOpen || capturedCameraPhoto) return
    setCameraNow(new Date())
    const clock = window.setInterval(() => setCameraNow(new Date()), 1000)
    return () => window.clearInterval(clock)
  }, [isCameraOpen, capturedCameraPhoto])

  useEffect(() => {
    if (!isCameraOpen || !navigator.geolocation) return
    setCameraLocationError(null)
    // Added: POD capture uses a dedicated, zero-cache GPS watch rather than a saved trip location.
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const next = { latitude: position.coords.latitude, longitude: position.coords.longitude }
        cameraGpsRef.current = next
        setCameraGps(next)
        // Fix: compare with the lookup origin so small movements accumulate, but
        // stationary GPS drift cannot cancel an in-flight lookup or block capture.
        setCameraAddressGps((previous) => {
          if (previous && haversineKm(
            { lat: previous.latitude, lng: previous.longitude },
            { lat: next.latitude, lng: next.longitude },
          ) * 1000 < 25) return previous
          return next
        })
      },
      (error) => setCameraLocationError(error.message || 'Current GPS location is required.'),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [isCameraOpen])

  useEffect(() => {
    if (!isCameraOpen || !cameraAddressGps) return
    setIsCameraAddressLoading(true)
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(cameraAddressGps.latitude)}&lon=${encodeURIComponent(cameraAddressGps.longitude)}&addressdetails=1&countrycodes=ph&zoom=18`
        const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
        if (!response.ok) throw new Error('Address lookup failed')
        const result = await response.json()
        setCameraAddress(stripPhilippinesFromAddress(String(result?.display_name || '')) || 'Location address unavailable')
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setCameraAddress('Location address unavailable')
      } finally {
        if (!controller.signal.aborted) setIsCameraAddressLoading(false)
      }
    }, 500)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [isCameraOpen, cameraAddressGps])

  useEffect(() => {
    if (!isCameraOpen || capturedCameraPhoto) return
    void attachCameraStreamToVideo()
  }, [isCameraOpen, capturedCameraPhoto])
  const cameraPermissionSteps = getCameraPermissionSteps()

  return {
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
    openPodCameraCapture,
    podDraftByDropPoint,
    setCapturedCameraPhoto,
    setIsCameraPermissionDialogOpen,
    setPodFileForDropPoint,
    videoRef,
  }
}
