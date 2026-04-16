export interface PrepareImageOptions {
  maxDimension?: number
  maxBytes?: number
  minQuality?: number
  initialQuality?: number
}

const DEFAULTS: Required<PrepareImageOptions> = {
  maxDimension: 1600,
  maxBytes: 2 * 1024 * 1024,
  minQuality: 0.45,
  initialQuality: 0.9,
}

function readImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Unable to read image'))
    }
    img.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality)
  })
}

export async function prepareImageForUpload(file: File, options: PrepareImageOptions = {}): Promise<File> {
  if (typeof window === 'undefined' || !file.type.startsWith('image/')) return file

  const { maxDimension, maxBytes, minQuality, initialQuality } = { ...DEFAULTS, ...options }
  const image = await readImage(file)
  const largestSide = Math.max(image.width, image.height)
  const scale = largestSide > maxDimension ? maxDimension / largestSide : 1
  const targetWidth = Math.max(1, Math.round(image.width * scale))
  const targetHeight = Math.max(1, Math.round(image.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight

  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.drawImage(image, 0, 0, targetWidth, targetHeight)

  let quality = initialQuality
  let blob = await canvasToBlob(canvas, quality)
  while (blob && blob.size > maxBytes && quality > minQuality) {
    quality = Math.max(minQuality, quality - 0.1)
    blob = await canvasToBlob(canvas, quality)
  }

  if (!blob) return file
  if (blob.size >= file.size && scale === 1) return file

  const baseName = file.name.replace(/\.[^.]+$/, '')
  return new File([blob], `${baseName || 'image'}.jpg`, { type: 'image/jpeg' })
}
