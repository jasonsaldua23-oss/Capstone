'use client'

import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { PointerEvent, RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type AvatarCropState = {
  isOpen: boolean
  source: string | null
  zoom: number
  isDragging: boolean
  imageRef: RefObject<HTMLImageElement | null>
  setZoom: (value: number) => void
  close: () => void
  createCroppedFile: () => Promise<File | null>
  handlePointerDown: (event: PointerEvent<HTMLDivElement>) => void
  handlePointerMove: (event: PointerEvent<HTMLDivElement>) => void
  handlePointerUp: () => void
}

export function AvatarCropDialog({ crop, isSaving, onSave }: { crop: AvatarCropState; isSaving: boolean; onSave: (file: File) => void | Promise<void> }) {
  const { isOpen, source, zoom, isDragging, imageRef, setZoom, close, createCroppedFile, handlePointerDown, handlePointerMove, handlePointerUp } = crop
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) close() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Crop Profile Photo</DialogTitle>
          <DialogDescription>Adjust your photo, then save or cancel.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="mx-auto h-56 w-56 overflow-hidden rounded-full border bg-slate-100">
            <div
              className={`h-full w-full touch-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            >
              {source ? <img ref={imageRef} src={source} alt="Crop preview" className="h-full w-full select-none object-cover" draggable={false} /> : null}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="avatar-crop-zoom">Zoom</Label>
            <Input id="avatar-crop-zoom" type="range" min="1" max="2.5" step="0.01" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={close} disabled={isSaving}>Cancel</Button>
            <Button type="button" className="flex-1" disabled={isSaving || !source} onClick={async () => {
              try {
                const file = await createCroppedFile()
                if (!file) throw new Error('Failed to prepare image')
                await onSave(file)
                close()
              } catch (error: any) {
                toast.error(error?.message || 'Failed to save profile photo')
              }
            }}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
