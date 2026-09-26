'use client'

import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem } from '@/components/ui/dropdown-menu'
import { DRIVER_LICENSE_RESTRICTIONS, parseDriverLicenseCodes } from '@/lib/driver-license-restrictions'

// Fix: select every code shown on the license without replacing existing selections.
export function DriverLicenseSelect({ value, onChange, className, disabled, id }: {
  value: string
  onChange: (value: string) => void
  className?: string
  disabled?: boolean
  id?: string
}) {
  const codes = parseDriverLicenseCodes(value)
  const [open, setOpen] = useState(false)
  // Fix: lock Radix's pointer/keyboard handlers too, and close the menu after saving.
  // Reset during render when `disabled` flips on (React's prop-change pattern), so
  // the menu cannot pop back open when the control is re-enabled.
  const [wasDisabled, setWasDisabled] = useState(disabled)
  if (disabled !== wasDisabled) {
    setWasDisabled(disabled)
    if (disabled) setOpen(false)
  }
  return (
    <DropdownMenu open={!disabled && open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button type="button" id={id} disabled={disabled} aria-label="Driver license restrictions" className={className}>
          <span className="flex items-center justify-between gap-2">
            <span>{codes.join(', ') || 'Select restrictions'}</span>
            <ChevronDown className="h-4 w-4 shrink-0" />
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {DRIVER_LICENSE_RESTRICTIONS.map(({ code, label }) => (
          <DropdownMenuCheckboxItem key={code} checked={codes.includes(code)} disabled={disabled}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) => { if (!disabled) onChange((checked ? [...codes, code] : codes.filter((item) => item !== code)).join(',')) }}>
            {label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
