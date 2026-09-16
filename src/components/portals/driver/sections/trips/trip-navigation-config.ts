import { type OsrmStep } from '@/components/shared/NavInstructionsPanel'

export type DriverRouteOption = {
  id: string
  points: [number, number][]
  originPoints: [number, number][]
  activeLegPoints: [number, number][]
  futureLegPoints: [number, number][]
  steps: OsrmStep[]
}

// Distance from the active route beyond which turn-by-turn stops advancing and
// waits for the reroute — kept in step with the map's off-route snap budget so
// the instruction and the vehicle icon agree on when the driver has left it.
export const NAVIGATION_OFF_ROUTE_METERS = 60

// A maneuver counts as passed only once the driver is this far beyond it, so GPS
// jitter around a junction cannot flip the instruction back and forth.
export const NAVIGATION_MANEUVER_PASSED_MARGIN_METERS = 8
