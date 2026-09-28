/**
 * The parts of a stored driver position the report maps judge it by, read from a
 * LocationLog row (admin, warehouse) or the customer tracking payload. Missing or
 * nonsensical readings stay undefined: iOS reports -1 for an unknown speed or
 * bearing, and a missing speed is no reading, not a standstill.
 */
export function reportedFixFields(point: any): {
  speedMps?: number
  gpsHeading?: number
  accuracyMeters?: number
  recordedAtMs?: number
} {
  const nonNegative = (value: unknown) => {
    if (value === null || value === undefined || value === '') return undefined
    const number = Number(value)
    return Number.isFinite(number) && number >= 0 ? number : undefined
  }
  const recorded = point?.recordedAt ?? point?.recorded_at
  const recordedAtMs = recorded ? new Date(recorded).getTime() : NaN
  return {
    speedMps: nonNegative(point?.speed),
    gpsHeading: nonNegative(point?.heading),
    accuracyMeters: nonNegative(point?.accuracy),
    recordedAtMs: Number.isFinite(recordedAtMs) ? recordedAtMs : undefined,
  }
}
