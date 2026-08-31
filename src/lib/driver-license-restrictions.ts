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

// Added: which vehicles each LTO restriction code covers. Mirrors
// backend/core/driver_license.py so the portal blocks an unqualified driver at the
// same point the API would, with the same message.
//
// TRUCK is Code C: C is goods vehicles above 3,500 kg GVW, and every truck class this
// system can register carries 2,500 kg or more of payload, so all of them clear that
// threshold once the vehicle's own weight is counted. CE (heavy articulated) covers
// the truck it tows, so it is accepted too.
//
// TRICYCLE is Code A1, the LTO code for motorized tricycles, and the codes are treated
// as a seniority ladder: a driver cleared for the heavier vehicle is also cleared for the
// lighter one, so every code that qualifies for a truck qualifies for a tricycle too. A1
// stays the code the rejection message names, since it is the entry-level qualification
// for the vehicle.
//
// Only the two types the system can actually register are ruled on. Legacy VAN, CAR and
// MOTORCYCLE rows are deliberately left unruled: no new one can be created, and
// inventing a code requirement for them would invalidate existing assignments.
const TRUCK_CODES = ['C', 'CE']
const TRICYCLE_CODES = ['A1', ...TRUCK_CODES]

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
  return rule.accepted.includes(normalizeCode(licenseCode))
}
