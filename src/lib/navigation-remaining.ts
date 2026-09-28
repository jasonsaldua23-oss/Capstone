/**
 * Distance and time from where the driver is now to the next stop.
 *
 * The navigation panel used to add up the route's steps to the last stop of the
 * trip, and only the stretch to the next turn moved with the driver. Driving away
 * from the route changed nothing until a reroute had been fetched, and a trip with
 * several stops showed the total to the final one beside the next stop's name.
 * This measures to the next stop only, from the driver's current position on the
 * route, and adds the way back to the route while the driver is off it - so the
 * numbers fall as they close in and rise as they head away, at every fix.
 */

export type RemainingStep = { distance: number; duration: number }

/** Off the route by less than this is GPS wander beside the road, not distance to drive. */
export const OFF_ROUTE_TOLERANCE_METERS = 15
/** Pace for the way back to the route when the route itself gives none. */
const FALLBACK_SPEED_MPS = 7

export function remainingToNextStop({
  steps,
  nextStopStepCount,
  alongMeters,
  offRouteMeters,
}: {
  /** The route's steps from where it was planned, the next stop's first. */
  steps: RemainingStep[]
  /** How many of `steps` lead to the next stop. */
  nextStopStepCount: number
  /** The driver's position along the route, measured from its start. */
  alongMeters: number
  /** How far the driver is from the route. */
  offRouteMeters: number
}): { meters: number; seconds: number } {
  const legSteps = steps.slice(0, Math.max(0, nextStopStepCount))
  let legMeters = 0
  let legSeconds = 0
  for (const step of legSteps) {
    legMeters += Math.max(0, step.distance || 0)
    legSeconds += Math.max(0, step.duration || 0)
  }

  const along = Math.min(legMeters, Math.max(0, alongMeters))
  let seconds = 0
  let stepStart = 0
  for (const step of legSteps) {
    const distance = Math.max(0, step.distance || 0)
    const duration = Math.max(0, step.duration || 0)
    const stepEnd = stepStart + distance
    if (stepEnd > along) {
      // The part of this step still ahead takes its share of the step's time.
      const ahead = distance > 0 ? (stepEnd - Math.max(stepStart, along)) / distance : 0
      seconds += duration * ahead
    }
    stepStart = stepEnd
  }

  // The way back to the route grows continuously from the tolerance, so the count
  // does not jump the moment the driver is judged to have left the road.
  const detour = Math.max(0, offRouteMeters - OFF_ROUTE_TOLERANCE_METERS)
  const speed = legSeconds > 0 && legMeters > 0 ? legMeters / legSeconds : FALLBACK_SPEED_MPS
  return {
    meters: legMeters - along + detour,
    seconds: seconds + detour / speed,
  }
}
