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

// Standard Philippine LTO driver's license format: 1 letter, 2 digits, hyphen, 2 digits, hyphen, 6 digits
// e.g. D09-22-000984 (format: X00-00-000000)
export const PHILIPPINE_DRIVER_LICENSE_REGEX = /^[A-Z]\d{2}-\d{2}-\d{6}$/

export function isValidPhilippineDriverLicense(value: unknown): boolean {
  if (!value) return false
  const clean = String(value).trim().toUpperCase()
  return PHILIPPINE_DRIVER_LICENSE_REGEX.test(clean)
}

export function formatPhilippineDriverLicenseInput(value: string): string {
  const raw = value.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!raw) return ''
  const letter = raw.slice(0, 1).replace(/[^A-Z]/g, '')
  const rest = raw.slice(1).replace(/[^0-9]/g, '')
  let formatted = letter
  if (rest.length > 0) {
    formatted += rest.slice(0, 2)
  }
  if (rest.length > 2) {
    formatted += '-' + rest.slice(2, 4)
  }
  if (rest.length > 4) {
    formatted += '-' + rest.slice(4, 10)
  }
  return formatted
}
