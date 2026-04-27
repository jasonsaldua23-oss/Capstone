'use client'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type DriverNativeCameraGateDialogProps = {
  open: boolean
  message: string
  isChecking: boolean
  onOpenAppSettings: () => void
  onRetry: () => void
}

export function DriverNativeCameraGateDialog({
  open,
  message,
  isChecking,
  onOpenAppSettings,
  onRetry,
}: DriverNativeCameraGateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.5rem] border border-white/75 bg-gradient-to-b from-[#f4fbff] via-white to-[#eef8f2] p-0 shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:max-w-md">
        <DialogHeader>
          <div className="border-b border-sky-100/80 bg-white/70 px-5 pb-3.5 pt-5 backdrop-blur">
            <DialogTitle className="text-[1.45rem] font-black tracking-[-0.02em] text-[#123a67]">Camera Access Required</DialogTitle>
            <DialogDescription className="mt-1 text-sm text-[#4d6785]">
              This app requires camera permission before driver operations.
            </DialogDescription>
          </div>
        </DialogHeader>
        <div className="max-h-[calc(100dvh-10rem)] space-y-3 overflow-y-auto px-5 pb-5 pt-4">
          <p className="text-sm text-red-600">{message}</p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="h-11 rounded-xl border-sky-200 bg-white/85 font-semibold text-[#17365d] shadow-[0_8px_18px_rgba(15,23,42,0.08)] hover:bg-sky-50"
              onClick={onOpenAppSettings}
            >
              Open App Settings
            </Button>
            <Button
              className="h-11 rounded-xl bg-[#0d61ad] font-semibold text-white shadow-[0_12px_24px_rgba(2,132,199,0.28)] hover:bg-[#0b579c]"
              onClick={onRetry}
              disabled={isChecking}
            >
              {isChecking ? 'Checking...' : 'I Enabled It'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

