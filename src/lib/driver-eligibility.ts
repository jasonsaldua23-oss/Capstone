// Added: one shared eligibility rule keeps every "assign a driver" surface consistent
// (vehicle/truck assignment, trip assignment) so an incomplete or invalid license
// profile blocks the assignment before the driver ever tries to accept a delivery.
import {
  isValidPhilippineDriverLicense,
  isValidDriverLicenseRestriction,
  isLicenseCodeAllowedForVehicle,
  getRequiredLicenseCodeForVehicle,
  notQualifiedForVehicleMessage,
} from './driver-license-restrictions'

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
  const status = String(driver?.status || driver?.driverStatus || '').trim().toUpperCase().replace(/\s+/g, '_')
  if (driver?.isActive === false || status === 'INACTIVE') return 'Inactive'
  if (status === 'ON_LEAVE' || status === 'ONLEAVE') return 'On leave'
  return getDriverProfileCompletenessIssue(driver)
}

/**
 * Reason the driver's registered license restriction does not cover this vehicle,
 * or '' when it does. A driver holding only Code A, for example, cannot be put on a
 * tricycle or a truck — both require Code C.
 */
export function getDriverVehicleLicenseIssue(driver: any, vehicle: any): string {
  if (!driver || !vehicle) return ''
  const vehicleType = String(vehicle?.type || vehicle?.vehicleType || '').trim()
  const requiredCode = getRequiredLicenseCodeForVehicle(vehicleType)
  if (!requiredCode) return ''
  const licenseType = readField(driver, 'licenseType', 'license_type')
  if (isLicenseCodeAllowedForVehicle(licenseType, vehicleType)) return ''
  return notQualifiedForVehicleMessage(requiredCode)
}

/**
 * Full check for putting this driver behind the wheel of this vehicle: the driver's
 * own profile has to be valid AND their license code has to cover the vehicle.
 */
export function getDriverVehicleAssignmentIssue(driver: any, vehicle: any): string {
  return getDriverAssignmentIssue(driver) || getDriverVehicleLicenseIssue(driver, vehicle)
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
  options?: { loadFailed?: boolean; loading?: boolean }
): { hasSelectable: boolean; message: string } {
  if (options?.loadFailed) {
    return {
      hasSelectable: false,
      message: 'Drivers could not be loaded. Check your connection and refresh, then try again.',
    }
  }

  // An in-flight fetch is not the same as an empty roster: staying silent here
  // keeps the load from being reported as "no drivers exist".
  if (options?.loading) {
    return { hasSelectable: false, message: '' }
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
