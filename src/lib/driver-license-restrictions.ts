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

// Fix: preserve existing single-code values while accepting explicit combinations.
export function parseDriverLicenseCodes(value: unknown): string[] {
  const normalized = String(value ?? '').trim().toUpperCase()
  return normalized ? [...new Set(normalized.split(/[,\s]+/))] : []
}

export function isValidDriverLicenseRestriction(value: string): boolean {
  const codes = parseDriverLicenseCodes(value)
  return codes.length > 0 && codes.every((code) => DRIVER_LICENSE_RESTRICTIONS.some((restriction) => restriction.code === code))
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

// Basic fleet policy, mirrored in backend/core/driver_license.py.
// Staff verify truck GVW separately; higher codes never imply another entitlement.
// LTO: https://lto.gov.ph/wp-content/uploads/2023/09/14-CC2024-DL-CODES.pdf
const TRUCK_CODES = ['C']
const TRICYCLE_CODES = ['A1']

export const VEHICLE_LICENSE_RULES: Record<string, { required: string; accepted: string[] }> = {
  TRUCK: { required: 'C', accepted: TRUCK_CODES },
  TRICYCLE: { required: 'A1', accepted: TRICYCLE_CODES },
}

export const notQualifiedForVehicleMessage = (requiredCode: string) =>
  `Driver is not qualified to drive this vehicle. License Code ${requiredCode} is required.`

const normalizeCode = (value: unknown) => String(value ?? '').trim().toUpperCase()

/** The restriction code a driver must hold for this vehicle type, or '' when unruled. */
export function getRequiredLicenseCodeForVehicle(vehicleType: unknown): string {
  return VEHICLE_LICENSE_RULES[normalizeCode(vehicleType)]?.required || ''
}

export function isLicenseCodeAllowedForVehicle(licenseCode: unknown, vehicleType: unknown): boolean {
  const rule = VEHICLE_LICENSE_RULES[normalizeCode(vehicleType)]
  // An unmapped legacy type is not something this rule can judge, so it is left to
  // the other profile checks rather than blocking every driver.
  if (!rule) return true
  return isValidDriverLicenseRestriction(String(licenseCode ?? '')) && parseDriverLicenseCodes(licenseCode).some((code) => rule.accepted.includes(code))
}
