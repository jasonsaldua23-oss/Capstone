'use client'

type PodImagePreviewProps = {
  src: string
  alt?: string
  className?: string
}

export function PodImagePreview({ src, alt = 'Proof of delivery', className = '' }: PodImagePreviewProps) {
  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open full-size ${alt}`}
      className="block cursor-zoom-in"
    >
      {/* Added: thumbnails remain compact, while clicking opens the uncropped source. */}
      <img
        src={src}
        alt={alt}
        className={className || 'h-64 w-full rounded-xl border border-slate-200 bg-slate-50 object-contain'}
      />
      <span className="mt-1 block text-xs font-medium text-sky-700">Click to view full-size POD</span>
    </a>
  )
}

