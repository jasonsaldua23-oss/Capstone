'use client'

import { useState } from 'react'
import { X } from 'lucide-react'

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
        {/*
          The driver portal stacks its map overlays, action bar and trip sheet from
          z-[1000] to z-[1250], and this dialog is portalled to the body alongside
          them. At the default z-50 the full-size photo opened behind the sheet and
          looked like nothing had happened, so both layers are raised past them.
        */}
        <DialogContent
          className="z-[1300] max-h-[94vh] w-[96vw] max-w-6xl overflow-y-auto bg-slate-950 p-3"
          overlayClassName="z-[1300]"
          showCloseButton={false}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>{alt}</DialogTitle>
            <DialogDescription>Enlarged image preview</DialogDescription>
          </DialogHeader>
          {/*
            The shared close button draws in the inherited foreground colour, which is
            invisible against this dark panel and against a night-time delivery photo.
            This one carries its own solid background so it reads on any image.
          */}
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            aria-label="Close photo"
            className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-xl border border-white/70 bg-white text-[#2A2A2A] shadow-[0_2px_8px_rgba(0,0,0,0.35)] transition-colors hover:bg-[#F2F4F7] motion-reduce:transition-none"
          >
            <X className="h-4.5 w-4.5" />
          </button>
          <img src={src} alt={alt} className="max-h-[88vh] w-full rounded-md object-contain" />
        </DialogContent>
      </Dialog>
    </>
  )
}
