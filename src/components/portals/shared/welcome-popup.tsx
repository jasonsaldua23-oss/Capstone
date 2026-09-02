'use client'

import { X } from 'lucide-react'
import { createPortal } from 'react-dom'

type WelcomePopupProps = {
  open: boolean
  message: string
  subtitle: string
  onClose: () => void
  overlayClassName?: string
  panelClassName: string
  titleClassName: string
  subtitleClassName: string
  buttonClassName: string
}

export function WelcomePopup({
  open,
  message,
  subtitle,
  onClose,
  overlayClassName,
  panelClassName,
  titleClassName,
  subtitleClassName,
  buttonClassName,
}: WelcomePopupProps) {
  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div data-welcome-popup className={`fixed inset-0 z-[999] flex items-center justify-center p-4 backdrop-blur-[2px] ${overlayClassName || 'bg-black/70'}`}>
      <div className={`w-full max-w-md rounded-2xl border p-4 shadow-2xl ${panelClassName}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className={`text-xl font-extrabold leading-tight tracking-[-0.01em] ${titleClassName}`}>{message}</p>
            <p className={`mt-1 text-sm ${subtitleClassName}`}>{subtitle}</p>
          </div>
          <button
            type="button"
            aria-label="Close welcome popup"
            onClick={onClose}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${buttonClassName}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
