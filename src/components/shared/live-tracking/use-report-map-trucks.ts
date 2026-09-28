'use client'

/**
 * Vehicles on the maps that learn positions a report at a time: admin Live
 * Tracking, the warehouse's, and the customer's delivery map.
 *
 * Each report is judged by `report-tracker`; a confirmed move is matched onto the
 * road actually driven by `road-match`, and `track-playout` plays that road back at
 * the speed it was driven. The planned route to the next stop is only drawn - it no
 * longer decides where the icon goes, so a driver who carries straight on past the
 * planned turn, takes another road or turns round is shown doing exactly that.
 *
 * The navigation map in the driver's own app keeps the predictive motion model in
 * `truck-motion`, which it feeds with a fix every second; nothing here runs there.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ingestReport, movementBearing, type ReportFix, type ReportTracker } from './report-tracker'
import { fetchMatchedLeg, fetchNearestRoadPoint } from './road-match'
import {
  appendLeg,
  createPlayout,
  fastForwardPlayout,
  isPlayoutSettled,
  playoutLead,
  playoutPose,
  relocatePlayout,
  stepPlayout,
  type TrackPlayout,
} from './track-playout'
import { movingBearing } from './vehicle-motion'
import type { DriverLocation } from './types'

type LatLng = [number, number]

/** The route line is redrawn from the icon each time it has moved this far. */
const LEAD_REDRAW_METERS = 2
/** A first sighting glides onto the road over this long. */
const ONTO_ROAD_MS = 600

function reportFixOf(location: DriverLocation, receivedAtMs: number): ReportFix {
  const finite = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
  return {
    lat: location.actualLat ?? location.lat,
    lng: location.actualLng ?? location.lng,
    recordedAtMs: finite(location.recordedAtMs),
    receivedAtMs,
    speedMps: finite(location.speedMps),
    headingDeg: finite(location.gpsHeading),
    accuracyM: finite(location.accuracyMeters),
  }
}

export function useReportMapTrucks({
  enabled,
  targets,
  targetSignature,
  visibilityEpoch,
  publish,
}: {
  enabled: boolean
  /** Every location on the map; the trucks among them are the ones moved here. */
  targets: DriverLocation[]
  /** Changes whenever `targets` does, so an unrelated render does not re-read them. */
  targetSignature: string
  visibilityEpoch: number
  publish: (locations: DriverLocation[]) => void
}) {
  const trackersRef = useRef(new Map<string, ReportTracker>())
  const playoutsRef = useRef(new Map<string, TrackPlayout>())
  // Legs of one vehicle are matched strictly in the order its reports came.
  const chainsRef = useRef(new Map<string, Promise<void>>())
  const targetsRef = useRef(targets)
  const frameRef = useRef<number | null>(null)
  const lastKeyRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [leads, setLeads] = useState<Record<string, LatLng[]>>({})
  const leadKeyRef = useRef('')

  const publishFrame = useCallback(() => {
    const poses: string[] = []
    const leadKeys: string[] = []
    const nextLeads: Record<string, LatLng[]> = {}
    const locations = targetsRef.current.map((target) => {
      if (target.markerType !== 'truck') return target
      const playout = playoutsRef.current.get(target.id)
      if (!playout) return target
      const pose = playoutPose(playout)
      poses.push(`${target.id}:${pose.point[0].toFixed(7)},${pose.point[1].toFixed(7)},${pose.heading?.toFixed(1) ?? ''}`)
      leadKeys.push(`${target.id}:${Math.round(pose.trackMeters / LEAD_REDRAW_METERS)}:${playout.meters[playout.meters.length - 1].toFixed(1)}`)
      nextLeads[target.id] = playoutLead(playout)
      return {
        ...target,
        lat: pose.point[0],
        lng: pose.point[1],
        markerHeading: pose.heading ?? target.markerHeading,
      }
    })
    const key = poses.join('|')
    if (key !== lastKeyRef.current) {
      lastKeyRef.current = key
      publish(locations)
    }
    const leadKey = leadKeys.join('|')
    if (leadKey !== leadKeyRef.current) {
      leadKeyRef.current = leadKey
      setLeads(nextLeads)
    }
  }, [publish])

  const startLoop = useCallback(() => {
    if (frameRef.current !== null) return
    const animate = (now: number) => {
      let settled = true
      for (const [id, playout] of playoutsRef.current) {
        const next = stepPlayout(playout, now)
        playoutsRef.current.set(id, next)
        if (!isPlayoutSettled(next)) settled = false
      }
      publishFrame()
      // The loop ends when every vehicle has come to rest; the next leg restarts it.
      frameRef.current = settled ? null : window.requestAnimationFrame(animate)
    }
    frameRef.current = window.requestAnimationFrame(animate)
  }, [publishFrame])

  useEffect(() => {
    abortRef.current = new AbortController()
    return () => {
      abortRef.current?.abort()
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    targetsRef.current = targets
    const receivedAt = performance.now()
    const trucks = targets.filter((location) => location.markerType === 'truck')
    const live = new Set(trucks.map((truck) => truck.id))
    for (const store of [trackersRef.current, playoutsRef.current, chainsRef.current] as Map<string, unknown>[]) {
      for (const id of Array.from(store.keys())) if (!live.has(id)) store.delete(id)
    }

    for (const truck of trucks) {
      const { tracker, outcome } = ingestReport(trackersRef.current.get(truck.id), reportFixOf(truck, receivedAt))
      trackersRef.current.set(truck.id, tracker)
      const signal = abortRef.current?.signal

      if (outcome.kind === 'first') {
        const heading = movementBearing(tracker) ?? (typeof truck.markerHeading === 'number' ? truck.markerHeading : null)
        const start: LatLng = [outcome.fix.lat, outcome.fix.lng]
        playoutsRef.current.set(truck.id, createPlayout(start, receivedAt, heading))
        // Start on the road rather than beside it, unless the vehicle is already on its way.
        const chain = fetchNearestRoadPoint(outcome.fix, movementBearing(tracker), signal).then((onRoad) => {
          const playout = playoutsRef.current.get(truck.id)
          if (!onRoad || !playout || signal?.aborted || playout.meters.length > 1) return
          playoutsRef.current.set(truck.id, appendLeg(playout, [start, onRoad], ONTO_ROAD_MS, performance.now(), { keepHeading: true }))
          startLoop()
        })
        chainsRef.current.set(truck.id, chain)
      } else if (outcome.kind === 'moved') {
        const previous = chainsRef.current.get(truck.id) ?? Promise.resolve()
        const chain = previous.then(async () => {
          const leg = await fetchMatchedLeg(outcome.window, signal)
          const playout = playoutsRef.current.get(truck.id)
          if (!playout || signal?.aborted) return
          // Unmatched (no road near, or the service is down): straight between the
          // two confirmed positions, which a few seconds apart is along the road.
          const from = outcome.window[outcome.window.length - 2]
          const path: LatLng[] = leg ?? [[from.lat, from.lng], [outcome.fix.lat, outcome.fix.lng]]
          playoutsRef.current.set(truck.id, appendLeg(playout, path, outcome.sinceLastMs, performance.now()))
          startLoop()
        })
        chainsRef.current.set(truck.id, chain)
      } else if (outcome.kind === 'relocated') {
        const playout = playoutsRef.current.get(truck.id)
        const point: LatLng = [outcome.fix.lat, outcome.fix.lng]
        playoutsRef.current.set(
          truck.id,
          playout ? relocatePlayout(playout, point, outcome.sinceLastMs, receivedAt) : createPlayout(point, receivedAt)
        )
      }
    }
    // New locations always commit once, on the next frame, even with every truck
    // standing still: a stop pin may have changed colour, and a map with no truck
    // on it at all has no pose to tell one set of pins from the next.
    lastKeyRef.current = null
    startLoop()
  }, [enabled, targetSignature, targets, startLoop])

  // A hidden page paints nothing, so the legs that came in meanwhile would all be
  // replayed on return. Show where the vehicles are now instead.
  useEffect(() => {
    if (!enabled || document.visibilityState !== 'visible') return
    const now = performance.now()
    for (const [id, playout] of playoutsRef.current) {
      if (!isPlayoutSettled(playout)) playoutsRef.current.set(id, fastForwardPlayout(playout, now))
    }
    startLoop()
  }, [enabled, visibilityEpoch, startLoop])

  /** Which way the vehicle on a route line is going, to start that route on the right side of the road. */
  const bearingForRoadLine = useCallback((roadLineId: string) => {
    const truck = targetsRef.current.find((location) => location.markerType === 'truck' && location.roadLineId === roadLineId)
    if (!truck) return null
    return movingBearing(truck.gpsHeading, truck.speedMps) ?? movementBearing(trackersRef.current.get(truck.id))
  }, [])

  return { leads, bearingForRoadLine }
}
