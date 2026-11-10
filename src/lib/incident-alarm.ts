/**
 * The warehouse emergency alarm for accidents and vehicle damage.
 *
 * Every warehouse laptop with the portal open sounds a siren and covers the portal
 * with a red alert while a report from one of its trips is still unacknowledged; the
 * first person to press Acknowledge stops it everywhere (the `incidents` sync scope
 * carries the change). Only staff who can acknowledge are rung: for anyone else the
 * alarm could never stop.
 *
 * Pure helpers only, so `node --test` can load this file without the app's aliases.
 */

import type { VehicleIncident } from './vehicle-incidents.ts'

const timeOf = (value: string) => {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** The reports that should be ringing on this laptop, newest first. */
export function alarmingIncidents(incidents: readonly VehicleIncident[]): VehicleIncident[] {
  return incidents
    .filter((incident) => incident.status === 'REPORTED' && incident.canManage)
    .sort((a, b) => timeOf(b.reportedAt) - timeOf(a.reportedAt))
}

export function alarmHeadline(incident: Pick<VehicleIncident, 'type'>): string {
  return incident.type === 'ACCIDENT' ? 'ACCIDENT REPORTED' : 'VEHICLE DAMAGE REPORTED'
}
