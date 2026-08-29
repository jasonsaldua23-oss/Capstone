// Added: one shared eligibility rule keeps every "assign a driver" surface consistent
// (vehicle/truck assignment, trip assignment) so an incomplete or invalid license
// profile blocks the assignment before the driver ever tries to accept a delivery.
import { isValidPhilippineDriverLicense, isValidDriverLicenseRestriction } from './driver-license-restrictions'

const todayIsoDate = () => new Date().toISOString().slice(0, 10)

const readField = (driver: any, ...keys: string[]): string => {
  for (const key of keys) {
    const direct = driver?.[key]
    if (direct !== undefined && direct !== null && String(direct).trim()) return String(direct).trim()
    const nested = driver?.user?.[key]
    if (nested !== undefined && nested !== null && String(nested).trim()) return String(nested).trim()
  }
  return ''
}

/**
 * Returns a human-readable reason why the driver's own profile is not fit for
 * assignment, or '' when the profile is complete and valid.
 */
export function getDriverProfileCompletenessIssue(driver: any): string {
  if (!driver) return 'Driver not found'
  const phone = readField(driver, 'phone')
  const licenseNumber = readField(driver, 'licenseNumber', 'license_number')
  const licenseType = readField(driver, 'licenseType', 'license_type')
  const licenseExpiry = readField(driver, 'licenseExpiry', 'license_expiry')

  if (!phone || !licenseNumber || !licenseType || !licenseExpiry) {
    return 'Incomplete driver license profile'
  }
  if (!isValidPhilippineDriverLicense(licenseNumber)) {
    return 'Invalid driver license format (LTO: X00-00-000000)'
  }
  if (!isValidDriverLicenseRestriction(licenseType.toUpperCase())) {
    return 'Invalid driver license restriction'
  }
  if (licenseExpiry.slice(0, 10) < todayIsoDate()) {
    return 'Driver license has expired'
  }
  return ''
}

/**
 * Reason why the driver cannot be assigned to a vehicle/truck right now,
 * or '' when the driver is assignable. Covers account status on top of the
 * license profile checks.
 */
export function getDriverAssignmentIssue(driver: any): string {
  if (!driver) return 'Driver not found'
  const status = String(driver?.status || '').toUpperCase()
  if (driver?.isActive === false || status === 'INACTIVE') return 'Inactive'
  return getDriverProfileCompletenessIssue(driver)
}

export function isDriverAssignable(driver: any): boolean {
  return !getDriverAssignmentIssue(driver)
}

/**
 * Explains an empty "Assign Driver" dropdown. `getIssue` returns '' for a driver
 * that can be picked, so callers pass whichever eligibility rule applies to the
 * surface (vehicle assignment or trip assignment).
 */
export function summarizeDriverAvailability(
  drivers: any[],
  getIssue: (driver: any) => string,
  options?: { loadFailed?: boolean }
): { hasSelectable: boolean; message: string } {
  if (options?.loadFailed) {
    return {
      hasSelectable: false,
      message: 'Drivers could not be loaded. Check your connection and refresh, then try again.',
    }
  }

  const list = Array.isArray(drivers) ? drivers : []
  if (list.length === 0) {
    return {
      hasSelectable: false,
      message:
        'No drivers are registered yet. Add a driver with a complete license profile and an available assigned vehicle.',
    }
  }

  const issues = list.map((driver) => getIssue(driver) || '')
  if (issues.some((issue) => !issue)) return { hasSelectable: true, message: '' }

  const counts = new Map<string, number>()
  for (const issue of issues) counts.set(issue, (counts.get(issue) ?? 0) + 1)
  const breakdown = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${count} ${count === 1 ? 'driver' : 'drivers'} — ${reason}`)
    .join('; ')

  return {
    hasSelectable: false,
    message: `No driver can be assigned right now. ${breakdown}.`,
  }
}
