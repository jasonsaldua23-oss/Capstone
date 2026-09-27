import type { DriverLocation } from './types'

/**
 * Several orders to one address share a coordinate, and their pins were drawn
 * exactly on top of one another, so only the last one could be seen or opened.
 * The pins of such a group are fanned out instead: each one is tilted about its
 * own tip, so every tip stays on the real coordinate while the heads lean apart.
 * Angles are on screen, so the fan holds its shape at every zoom and the
 * coordinates are never altered.
 */

// The widest a fanned pin leans either side of upright; past this a head reads as lying down.
const MAX_TILT_DEG = 75

// Five decimals is about a metre: pins that close cover each other at any zoom.
const coordinateKey = (lat: number, lng: number) => `${lat.toFixed(5)},${lng.toFixed(5)}`

/**
 * Tilt in degrees (clockwise, as CSS rotate) per pin id. Every pin in a group
 * has an entry (the middle one of an odd group gets 0); a pin that stands alone
 * has none. `stepDeg` separates neighbouring heads, narrowed when a large group
 * would otherwise lean past MAX_TILT_DEG.
 */
export function coincidentPinTilts(locations: DriverLocation[], stepDeg: number): Map<string, number> {
  const groups = new Map<string, string[]>()
  for (const location of locations) {
    if (location.markerType !== 'pin') continue
    const key = coordinateKey(location.lat, location.lng)
    const group = groups.get(key)
    if (group) group.push(location.id)
    else groups.set(key, [location.id])
  }

  const tilts = new Map<string, number>()
  for (const ids of groups.values()) {
    if (ids.length < 2) continue
    const step = Math.min(stepDeg, (2 * MAX_TILT_DEG) / (ids.length - 1))
    ids.forEach((id, index) => tilts.set(id, (index - (ids.length - 1) / 2) * step))
  }
  return tilts
}

/** A screen offset turned clockwise by `deg`, as CSS rotate turns it. */
export function rotateScreenOffset([x, y]: [number, number], deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return [x * cos - y * sin, x * sin + y * cos]
}
