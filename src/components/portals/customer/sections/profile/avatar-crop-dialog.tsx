'use client'

import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function CustomerAvatarCropDialog(props: any) {
  const {
    isAvatarCropDialogOpen,
    setIsAvatarCropDialogOpen,
    avatarCropSource,
    setAvatarCropSource,
    setAvatarCropFile,
    isDraggingCrop,
    handleCropPointerDown,
    handleCropPointerMove,
    handleCropPointerUp,
    avatarCropImageRef,
    avatarCropZoom,
    setAvatarCropZoom,
    isSavingProfile,
    createCroppedAvatarFile,
    avatarCropFile,
    handleAvatarUpload,
  } = props

  return (
    <Dialog
      open={isAvatarCropDialogOpen}
      onOpenChange={(open) => {
        setIsAvatarCropDialogOpen(open)
        if (!open) {
          if (avatarCropSource?.startsWith('blob:')) {
            URL.revokeObjectURL(avatarCropSource)
          }
          setAvatarCropSource(null)
          setAvatarCropFile(null)
        }
      }}
    >
      <DialogContent className="max-w-md">
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
        >
          <DialogHeader>
            <DialogTitle>Crop Profile Photo</DialogTitle>
            <DialogDescription>Adjust and confirm before upload.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="mx-auto h-56 w-56 overflow-hidden rounded-full border bg-slate-100">
              <div
                className={`h-full w-full touch-none ${isDraggingCrop ? 'cursor-grabbing' : 'cursor-grab'}`}
                onPointerDown={handleCropPointerDown}
                onPointerMove={handleCropPointerMove}
                onPointerUp={handleCropPointerUp}
                onPointerLeave={handleCropPointerUp}
              >
                {avatarCropSource ? (
                  <img
                    ref={avatarCropImageRef}
                    src={avatarCropSource}
                    alt="Crop preview"
                    className="h-full w-full object-cover select-none"
                    draggable={false}
                  />
                ) : null}
              </div>
            </div>
            <p className="text-xs text-gray-500 -mt-2 text-center">Drag photo to position, then tap Apply & Upload.</p>

            <div className="space-y-2">
              <Label htmlFor="avatar-zoom">Zoom</Label>
              <Input
                id="avatar-zoom"
                type="range"
                min="1"
                max="2.5"
                step="0.01"
                value={avatarCropZoom}
                onChange={(e) => setAvatarCropZoom(Number(e.target.value))}
              />
            </div>

            <Button
              className="w-full"
              disabled={isSavingProfile || !avatarCropSource}
              onClick={async () => {
                try {
                  const croppedFile = await createCroppedAvatarFile()
                  const fileToUpload = croppedFile || avatarCropFile
                  if (!fileToUpload) throw new Error('Failed to prepare image')
                  await handleAvatarUpload(fileToUpload)
                  setIsAvatarCropDialogOpen(false)
                } catch (error: any) {
                  toast.error(error?.message || 'Failed to upload photo')
                }
              }}
            >
              {isSavingProfile ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                'Apply & Upload'
              )}
            </Button>
          </div>
        </motion.div>
      </DialogContent>
    </Dialog>
  )
}
