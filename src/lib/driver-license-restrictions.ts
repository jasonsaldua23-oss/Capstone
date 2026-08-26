// Added: one shared LTO restriction list keeps admin and driver dropdowns consistent.
export const DRIVER_LICENSE_RESTRICTIONS = [
  { code: 'A', label: 'A' },
  { code: 'A1', label: 'A1' },
  { code: 'B', label: 'B' },
  { code: 'B1', label: 'B1' },
  { code: 'B2', label: 'B2' },
  { code: 'C', label: 'C' },
  { code: 'D', label: 'D' },
  { code: 'BE', label: 'BE' },
  { code: 'CE', label: 'CE' },
] as const

export function isValidDriverLicenseRestriction(value: string): boolean {
  return DRIVER_LICENSE_RESTRICTIONS.some((restriction) => restriction.code === value)
}
