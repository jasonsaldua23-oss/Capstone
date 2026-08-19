'use client'

import * as React from 'react'

export interface SwitchProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
}

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ className = '', checked = false, onCheckedChange, disabled = false, ...props }, ref) => {
    const handleClick = () => {
      if (disabled) return
      onCheckedChange?.(!checked)
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        onCheckedChange?.(!checked)
      }
    }

    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        ref={ref}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
          checked ? 'bg-blue-600' : 'bg-slate-200'
        } ${className}`}
        {...props}
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    )
  }
)

Switch.displayName = 'Switch'
