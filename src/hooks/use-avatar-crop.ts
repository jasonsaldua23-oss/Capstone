'use client'

import { useEffect, useRef, useState } from 'react'

export function useAvatarCrop() {
  const [isOpen, setIsOpen] = useState(false)
  const [source, setSource] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [zoom, setZoom] = useState(1)
  const [offsetX, setOffsetX] = useState(0)
  const [offsetY, setOffsetY] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const dragRef = useRef({ active: false, startX: 0, startY: 0, initialX: 0, initialY: 0 })

  useEffect(() => {
    if (!imageRef.current || !source) return
    imageRef.current.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${zoom})`
    imageRef.current.style.transformOrigin = 'center center'
  }, [source, offsetX, offsetY, zoom])

  const open = (nextFile: File | null) => {
    if (!nextFile) return
    const objectUrl = URL.createObjectURL(nextFile)
    setFile(nextFile)
    setSource(objectUrl)
    setZoom(1)
    setOffsetX(0)
    setOffsetY(0)
    setIsOpen(true)
  }

  const close = () => {
    if (source?.startsWith('blob:')) URL.revokeObjectURL(source)
    setIsOpen(false)
    setSource(null)
    setFile(null)
    setIsDragging(false)
  }

  const createCroppedFile = async (): Promise<File | null> => {
    if (!source) return null
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image()
      nextImage.onload = () => resolve(nextImage)
      nextImage.onerror = () => reject(new Error('Failed to load image'))
      nextImage.src = source
    })
    const outputSize = 512
    const canvas = document.createElement('canvas')
    canvas.width = outputSize
    canvas.height = outputSize
    const context = canvas.getContext('2d')
    if (!context) return null
    const baseScale = Math.max(outputSize / image.width, outputSize / image.height)
    const scale = baseScale * zoom
    context.drawImage(
      image,
      (outputSize - image.width * scale) / 2 + offsetX,
      (outputSize - image.height * scale) / 2 + offsetY,
      image.width * scale,
      image.height * scale
    )
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
    return blob ? new File([blob], `avatar-${Date.now()}.jpg`, { type: 'image/jpeg' }) : null
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!source) return
    dragRef.current = { active: true, startX: event.clientX, startY: event.clientY, initialX: offsetX, initialY: offsetY }
    setIsDragging(true)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return
    const clamp = (value: number) => Math.max(-160, Math.min(160, value))
    setOffsetX(clamp(dragRef.current.initialX + event.clientX - dragRef.current.startX))
    setOffsetY(clamp(dragRef.current.initialY + event.clientY - dragRef.current.startY))
  }

  const handlePointerUp = () => {
    dragRef.current.active = false
    setIsDragging(false)
  }

  return {
    isOpen,
    source,
    file,
    zoom,
    isDragging,
    imageRef,
    setIsOpen,
    setSource,
    setFile,
    setZoom,
    open,
    close,
    createCroppedFile,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  }
}
