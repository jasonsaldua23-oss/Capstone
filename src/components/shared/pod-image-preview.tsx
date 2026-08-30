'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type PodImagePreviewProps = {
  src: string
  alt?: string
  className?: string
  caption?: string
}

export function PodImagePreview({
  src,
  alt = 'Proof of delivery',
  className = '',
  caption = 'Click to view full-size photo',
}: PodImagePreviewProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label={`Open full-size ${alt}`}
        className="block w-full cursor-zoom-in text-left"
      >
        {/* Added: clicking a compact thumbnail opens an in-page enlarged preview. */}
        <img
          src={src}
          alt={alt}
          className={className || 'h-64 w-full rounded-xl border border-slate-200 bg-slate-50 object-contain'}
        />
        <span className="mt-1 block text-xs font-medium text-sky-700">{caption}</span>
      </button>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-h-[94vh] w-[96vw] max-w-6xl overflow-y-auto bg-slate-950 p-3">
          <DialogHeader className="sr-only">
            <DialogTitle>{alt}</DialogTitle>
            <DialogDescription>Enlarged image preview</DialogDescription>
          </DialogHeader>
          <img src={src} alt={alt} className="max-h-[88vh] w-full rounded-md object-contain" />
        </DialogContent>
      </Dialog>
    </>
  )
}
