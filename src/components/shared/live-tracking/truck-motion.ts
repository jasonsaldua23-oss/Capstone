/**
 * Per-truck glue between incoming fixes and the vehicle-motion model.
 *
 * On the navigation route the truck moves in one dimension - metres along the
 * road - and the model predicts between fixes. Anywhere else (other portals'
 * maps, or a driver who has left the route while a reroute is in flight) it moves
 * on a local east/north plane with one model per axis and no prediction, so the
 * icon glides between reported positions instead of stepping.
 */
import { bearingBetweenMapPoints, projectPointOntoRoute, routePoseAtDistance } from '@/lib/map-navigation'
import { approximateDistanceMeters } from './geometry'
import { TRUCK_MAX_ROUTE_SNAP_METERS, TRUCK_STATIONARY_THRESHOLD_METERS } from './tuning'
import type { DriverLocation } from './types'
import {
  MOTION_STATIONARY_SPEED_MPS,
  acceptFix,
  createMotionState,
  isMotionSettled,
  movingBearing,
  rebaseMotion,
  resetMotion,
  shortestHeadingDelta,
  stepHeading,
  stepMotion,
  type MotionOptions,
  type VehicleMotionState,
} from './vehicle-motion'

export type TruckMotionContext = {
  route: [number, number][]
  routeKey: string
  /** Predict along the route between fixes (navigation view). */
  predict: boolean
  nowMs: number
}

type RouteMotion = {
  mode: 'route'
  routeKey: string
  along: VehicleMotionState
}

type PlanarMotion = {
  mode: 'planar'
  /** [lat, lng] the east/north metres are measured from. */
  origin: [number, number]
  east: VehicleMotionState
  north: VehicleMotionState
}

export type TruckMotion = (RouteMotion | PlanarMotion) & {
  /** The fix last folded in; an unchanged fix is not folded in twice. */
  fixSignature: string
  fixPoint: [number, number]
  heading: number | null
  desiredHeading: number | null
  /** Route tangent under the icon may be flipped to match the fix's heading. */
  headingFlipped: boolean
}

const NO_PREDICT: MotionOptions = { predict: false }
const HEADING_SETTLED_DEGREES = 0.05

export function truckFixSignature(location: DriverLocation): string {
  return [
    location.lat, location.lng, location.speedMps ?? '', location.markerHeading ?? '', location.routeProgressMeters ?? '',
  ].join(',')
}

function toLocalMeters(origin: [number, number], point: [number, number]): { east: number; north: number } {
  const cosLat = Math.cos((origin[0] * Math.PI) / 180) || 1
  return { east: (point[1] - origin[1]) * 111320 * cosLat, north: (point[0] - origin[0]) * 110540 }
}

function fromLocalMeters(origin: [number, number], east: number, north: number): [number, number] {
  const cosLat = Math.cos((origin[0] * Math.PI) / 180) || 1
  return [origin[0] + north / 110540, origin[1] + east / (111320 * cosLat)]
}

/** Where the icon is drawn right now. */
export function truckMotionPose(motion: TruckMotion, route: [number, number][]): {
  point: [number, number]
  heading: number | null
  routeProgressMeters: number | undefined
  speedMps: number
} {
  if (motion.mode === 'route') {
    const pose = routePoseAtDistance(route, motion.along.displayedMeters)
    return {
      point: pose?.point ?? motion.fixPoint,
      heading: motion.heading,
      routeProgressMeters: motion.along.displayedMeters,
      speedMps: Math.abs(motion.along.displayedVelocityMps),
    }
  }
  return {
    point: fromLocalMeters(motion.origin, motion.east.displayedMeters, motion.north.displayedMeters),
    heading: motion.heading,
    routeProgressMeters: undefined,
    speedMps: Math.hypot(motion.east.displayedVelocityMps, motion.north.displayedVelocityMps),
  }
}

/** The road tangent under the icon, turned round if the fix says the truck faces the other way. */
function routeDesiredHeading(route: [number, number][], progressMeters: number, fixHeading: number | null, flipped: boolean) {
  const tangent = routePoseAtDistance(route, progressMeters)?.heading ?? null
  if (tangent === null) return { heading: fixHeading, flipped }
  const nextFlipped = fixHeading === null ? flipped : Math.abs(shortestHeadingDelta(tangent, fixHeading)) > 90
  return { heading: nextFlipped ? (tangent + 180) % 360 : tangent, flipped: nextFlipped }
}

/** Snap straight to the fix: first sighting, or the tab was hidden and the journey since is stale. */
export function snapTruckMotion(previous: TruckMotion | undefined, target: DriverLocation, ctx: TruckMotionContext): TruckMotion {
  const fixPoint: [number, number] = [target.lat, target.lng]
  const fixHeading = movingBearing(target.markerHeading, target.speedMps)
  const onRoute = ctx.route.length >= 2 && typeof target.routeProgressMeters === 'number'
  const speed = { reportedSpeedMps: target.speedMps ?? null, atMs: ctx.nowMs }
  const heading = fixHeading ?? previous?.heading ?? null
  if (onRoute) {
    const along = resetMotion(previous?.mode === 'route' ? previous.along : undefined, { progressMeters: target.routeProgressMeters as number, ...speed })
    const desired = routeDesiredHeading(ctx.route, along.displayedMeters, fixHeading, previous?.headingFlipped ?? false)
    return { mode: 'route', routeKey: ctx.routeKey, along, fixSignature: truckFixSignature(target), fixPoint, heading: desired.heading ?? heading, desiredHeading: desired.heading, headingFlipped: desired.flipped }
  }
  return {
    mode: 'planar',
    origin: fixPoint,
    east: createMotionState({ progressMeters: 0, ...speed }),
    north: createMotionState({ progressMeters: 0, ...speed }),
    fixSignature: truckFixSignature(target),
    fixPoint,
    heading,
    desiredHeading: heading,
    headingFlipped: false,
  }
}

/** Fold a new fix in without moving the icon. */
export function acceptTruckFix(previous: TruckMotion | undefined, target: DriverLocation, ctx: TruckMotionContext): TruckMotion {
  if (!previous) return snapTruckMotion(undefined, target, ctx)
  const signature = truckFixSignature(target)
  // Route metres only mean something on the geometry they were measured on, so
  // a replaced route re-bases the icon even when the fix itself has not changed.
  const routeReplaced = previous.mode === 'route' && previous.routeKey !== ctx.routeKey
  if (signature === previous.fixSignature && !routeReplaced) return previous

  const fixPoint: [number, number] = [target.lat, target.lng]
  const fixHeading = movingBearing(target.markerHeading, target.speedMps)
  const options: MotionOptions = { predict: ctx.predict }
  const reportedSpeedMps = target.speedMps ?? null
  const pose = truckMotionPose(previous, ctx.route)
  const sameRoute = previous.mode === 'route' && previous.routeKey === ctx.routeKey
  // Route metres can only carry the icon while it is actually on the road. After a
  // reroute the new geometry starts at the driver, so an icon still catching up from
  // an off-route detour is behind its start: projecting would clamp it to the start
  // and teleport it forward. It keeps gliding on the plane until it is back on the road.
  const drawnProjection = ctx.route.length >= 2 && !sameRoute ? projectPointOntoRoute(pose.point, ctx.route) : null
  const canAdopt = sameRoute || (drawnProjection !== null && drawnProjection.distanceFromRouteMeters <= TRUCK_MAX_ROUTE_SNAP_METERS)
  const onRoute = ctx.route.length >= 2 && typeof target.routeProgressMeters === 'number' && canAdopt

  if (onRoute) {
    const fix = { progressMeters: target.routeProgressMeters as number, atMs: ctx.nowMs, reportedSpeedMps }
    let along: VehicleMotionState
    if (sameRoute && previous.mode === 'route') {
      along = acceptFix(previous.along, fix, options)
    } else {
      // New route geometry, or arriving on the route from the plane: the icon
      // stays where it is drawn, re-measured along the new road.
      const drawnProgress = drawnProjection?.distanceAlongMeters ?? fix.progressMeters
      const carried = previous.mode === 'route'
        ? previous.along
        // An axis model's speed is that axis' share; the road wants the ground speed.
        : { ...previous.east, speedMps: reportedSpeedMps ?? pose.speedMps, accelMps2: 0 }
      along = rebaseMotion(carried, fix, drawnProgress, pose.speedMps, options)
    }
    const desired = routeDesiredHeading(ctx.route, along.displayedMeters, fixHeading, previous.headingFlipped)
    return {
      mode: 'route', routeKey: ctx.routeKey, along, fixSignature: signature, fixPoint,
      heading: previous.heading ?? desired.heading, desiredHeading: desired.heading, headingFlipped: desired.flipped,
    }
  }

  const movedMeters = approximateDistanceMeters(previous.fixPoint, fixPoint)
  const movementHeading = movedMeters >= TRUCK_STATIONARY_THRESHOLD_METERS ? bearingBetweenMapPoints(previous.fixPoint, fixPoint) : null
  const desiredHeading = fixHeading ?? movementHeading ?? previous.desiredHeading
  if (previous.mode === 'planar') {
    const local = toLocalMeters(previous.origin, fixPoint)
    // Each axis covers only its share of the ground speed, so the phone's reading
    // is split between them along the direction the fix moved in rather than
    // handed to both whole. Withholding it instead left each axis to measure its
    // own speed from the positions, and a parked vehicle's positions wander: the
    // measurement is a distance, never negative, so the wandering rectifies into
    // a speed of its own that never reaches zero and the icon spends the stop
    // chasing noise around the yard. A standstill splits to zero on both axes,
    // and that is the reading the wandering cannot fake.
    const eastMeters = local.east - previous.east.fixProgressMeters
    const northMeters = local.north - previous.north.fixProgressMeters
    const spanMeters = Math.hypot(eastMeters, northMeters)
    const shareOf = (axisMeters: number) =>
      reportedSpeedMps === null ? null : spanMeters > 0 ? (Math.abs(axisMeters) / spanMeters) * reportedSpeedMps : 0
    return {
      ...previous,
      east: acceptFix(previous.east, { progressMeters: local.east, atMs: ctx.nowMs, reportedSpeedMps: shareOf(eastMeters) }, NO_PREDICT),
      north: acceptFix(previous.north, { progressMeters: local.north, atMs: ctx.nowMs, reportedSpeedMps: shareOf(northMeters) }, NO_PREDICT),
      fixSignature: signature, fixPoint, desiredHeading,
    }
  }
  // Leaving the route: the plane is laid out from where the icon is drawn, and
  // the icon keeps rolling the way it was pointing while it glides to the fix.
  const origin = pose.point
  const local = toLocalMeters(origin, fixPoint)
  const headingRad = ((previous.heading ?? 0) * Math.PI) / 180
  const rebaseAxis = (progressMeters: number, velocity: number) =>
    rebaseMotion(previous.along, { progressMeters, atMs: ctx.nowMs, reportedSpeedMps }, 0, velocity, NO_PREDICT)
  return {
    mode: 'planar', origin,
    east: rebaseAxis(local.east, pose.speedMps * Math.sin(headingRad)),
    north: rebaseAxis(local.north, pose.speedMps * Math.cos(headingRad)),
    fixSignature: signature, fixPoint, heading: previous.heading, desiredHeading, headingFlipped: false,
  }
}

/** One animation frame. */
export function stepTruckMotion(motion: TruckMotion, ctx: TruckMotionContext): TruckMotion {
  let next: TruckMotion
  if (motion.mode === 'route') {
    const along = stepMotion(motion.along, ctx.nowMs, { predict: ctx.predict })
    // The tangent moves with the icon, so it is refreshed every frame; the flip
    // decided at the last fix carries, otherwise a bend would spin the icon.
    const tangent = routePoseAtDistance(ctx.route, along.displayedMeters)?.heading ?? null
    const desiredHeading = tangent === null ? motion.desiredHeading : motion.headingFlipped ? (tangent + 180) % 360 : tangent
    next = { ...motion, along, desiredHeading }
  } else {
    next = {
      ...motion,
      east: stepMotion(motion.east, ctx.nowMs, NO_PREDICT),
      north: stepMotion(motion.north, ctx.nowMs, NO_PREDICT),
    }
  }
  const dtS = Math.max(0, Math.min(0.1, (ctx.nowMs - lastStepAt(motion)) / 1000))
  const speed = truckMotionPose(next, ctx.route).speedMps
  next.heading = stepHeading(motion.heading, next.desiredHeading, speed, dtS)
  return next
}

function lastStepAt(motion: TruckMotion): number {
  return motion.mode === 'route' ? motion.along.lastStepAtMs : motion.east.lastStepAtMs
}

export function isTruckMotionSettled(motion: TruckMotion, ctx: TruckMotionContext): boolean {
  // A parked icon holds its heading, so a pending turn does not keep the loop alive.
  const headingSettled =
    motion.desiredHeading === null || motion.heading === null ||
    truckMotionPose(motion, ctx.route).speedMps < MOTION_STATIONARY_SPEED_MPS ||
    Math.abs(shortestHeadingDelta(motion.heading, motion.desiredHeading)) < HEADING_SETTLED_DEGREES
  if (!headingSettled) return false
  if (motion.mode === 'route') return isMotionSettled(motion.along, ctx.nowMs, { predict: ctx.predict })
  return isMotionSettled(motion.east, ctx.nowMs, NO_PREDICT) && isMotionSettled(motion.north, ctx.nowMs, NO_PREDICT)
}
