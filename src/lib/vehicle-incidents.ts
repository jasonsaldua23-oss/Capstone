/**
 * Accidents and vehicle damage that drivers report during a trip.
 *
 * The driver reports from the trip screen (POST /api/incidents). Until warehouse
 * staff resolve it, the admin and warehouse Live Tracking maps flag that vehicle:
 * its truck icon carries the alert where the vehicle is now, and a warning pin
 * marks where the incident happened once the vehicle is no longer there (or when
 * there is no live position for it at all).
 *
 * Pure helpers only, so `node --test` can load this file without the app's aliases.
 */

export type VehicleIncidentType = 'ACCIDENT' | 'VEHICLE_DAMAGE'
export type VehicleIncidentStatus = 'REPORTED' | 'ACKNOWLEDGED' | 'RESOLVED'
/** TRIP_ENDED is recorded when a trip ends with the incident open; never chosen by hand. */
export type VehicleIncidentOutcome = 'RESUMED' | 'SENT_FOR_REPAIR' | 'TRIP_ENDED'
export type VehicleIncidentLocationSource = 'DEVICE' | 'LAST_GPS'

export type VehicleIncident = {
  id: string
  incidentNumber: string
  type: VehicleIncidentType
  status: VehicleIncidentStatus
  isOpen: boolean
  vehicleCanContinue: boolean
  description: string
  photoUrl: string | null
  latitude: number | null
  longitude: number | null
  locationAccuracy: number | null
  locationSource: VehicleIncidentLocationSource | null
  locationRecordedAt: string | null
  tripId: string
  tripNumber: string
  tripStatus: string
  driverId: string
  driverName: string
  vehicleId: string
  vehiclePlate: string
  vehicleStatus: string
  reportedAt: string
  acknowledgedAt: string | null
  acknowledgedBy: string | null
  resolvedAt: string | null
  resolvedBy: string | null
  resolutionOutcome: VehicleIncidentOutcome | null
  resolutionNotes: string | null
  canManage: boolean
}

export type IncidentTone = 'accident' | 'damage'

export const INCIDENT_TYPE_OPTIONS: ReadonlyArray<{ value: VehicleIncidentType; label: string; hint: string }> = [
  { value: 'ACCIDENT', label: 'Accident', hint: 'A collision or crash involving the vehicle' },
  { value: 'VEHICLE_DAMAGE', label: 'Vehicle damage', hint: 'A breakdown, flat tire or other damage to the vehicle' },
]

export const INCIDENT_OUTCOME_OPTIONS: ReadonlyArray<{ value: VehicleIncidentOutcome; label: string; hint: string }> = [
  {
    value: 'RESUMED',
    label: 'Vehicle resumed the trip',
    hint: 'The vehicle is safe to drive and carried on.',
  },
  {
    value: 'SENT_FOR_REPAIR',
    label: 'Vehicle sent for repair',
    hint: 'The vehicle is set to Maintenance and cannot be dispatched until it is back in service.',
  },
]

const TYPE_LABELS: Record<VehicleIncidentType, string> = { ACCIDENT: 'Accident', VEHICLE_DAMAGE: 'Vehicle damage' }
const STATUS_LABELS: Record<VehicleIncidentStatus, string> = {
  REPORTED: 'Reported',
  ACKNOWLEDGED: 'Acknowledged',
  RESOLVED: 'Resolved',
}
const OUTCOME_LABELS: Record<VehicleIncidentOutcome, string> = {
  RESUMED: 'Vehicle resumed the trip',
  SENT_FOR_REPAIR: 'Vehicle sent for repair',
  TRIP_ENDED: 'Closed when the trip ended',
}

export const incidentTypeLabel = (type: VehicleIncidentType) => TYPE_LABELS[type]
export const incidentStatusLabel = (status: VehicleIncidentStatus) => STATUS_LABELS[status]
export const incidentOutcomeLabel = (outcome: VehicleIncidentOutcome) => OUTCOME_LABELS[outcome]
export const incidentTone = (type: VehicleIncidentType): IncidentTone => (type === 'ACCIDENT' ? 'accident' : 'damage')

/** What the people waiting on an open incident should expect next. */
export function incidentProgressLabel(incident: Pick<VehicleIncident, 'status' | 'acknowledgedBy'>): string {
  if (incident.status === 'REPORTED') return 'Awaiting warehouse response'
  if (incident.status === 'ACKNOWLEDGED') {
    return incident.acknowledgedBy ? `Acknowledged by ${incident.acknowledgedBy}` : 'Acknowledged by the warehouse'
  }
  return 'Resolved'
}

export const vehicleConditionLabel = (canContinue: boolean) =>
  canContinue ? 'Vehicle can continue the trip' : 'Vehicle cannot continue the trip'

const text = (value: unknown) => String(value ?? '').trim()
const nullableText = (value: unknown) => text(value) || null
const coordinate = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | null =>
  allowed.includes(value as T) ? (value as T) : null

/** One API row, or null when it is not an incident this client understands. */
export function parseIncident(raw: unknown): VehicleIncident | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const id = text(row.id)
  const type = oneOf(row.type, ['ACCIDENT', 'VEHICLE_DAMAGE'] as const)
  const status = oneOf(row.status, ['REPORTED', 'ACKNOWLEDGED', 'RESOLVED'] as const)
  if (!id || !type || !status) return null
  return {
    id,
    incidentNumber: text(row.incidentNumber),
    type,
    status,
    isOpen: status !== 'RESOLVED',
    vehicleCanContinue: row.vehicleCanContinue === true,
    description: text(row.description),
    photoUrl: nullableText(row.photoUrl),
    latitude: coordinate(row.latitude),
    longitude: coordinate(row.longitude),
    locationAccuracy: coordinate(row.locationAccuracy),
    locationSource: oneOf(row.locationSource, ['DEVICE', 'LAST_GPS'] as const),
    locationRecordedAt: nullableText(row.locationRecordedAt),
    tripId: text(row.tripId),
    tripNumber: text(row.tripNumber),
    tripStatus: text(row.tripStatus),
    driverId: text(row.driverId),
    driverName: text(row.driverName) || 'Driver',
    vehicleId: text(row.vehicleId),
    vehiclePlate: text(row.vehiclePlate),
    vehicleStatus: text(row.vehicleStatus),
    reportedAt: text(row.reportedAt),
    acknowledgedAt: nullableText(row.acknowledgedAt),
    acknowledgedBy: nullableText(row.acknowledgedBy),
    resolvedAt: nullableText(row.resolvedAt),
    resolvedBy: nullableText(row.resolvedBy),
    resolutionOutcome: oneOf(row.resolutionOutcome, ['RESUMED', 'SENT_FOR_REPAIR', 'TRIP_ENDED'] as const),
    resolutionNotes: nullableText(row.resolutionNotes),
    canManage: row.canManage === true,
  }
}

const timeOf = (value: string | null) => {
  const parsed = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : 0
}

/** Open incidents first, each group newest first. */
export function sortIncidents(incidents: readonly VehicleIncident[]): VehicleIncident[] {
  return [...incidents].sort((a, b) => Number(b.isOpen) - Number(a.isOpen) || timeOf(b.reportedAt) - timeOf(a.reportedAt))
}

export function parseIncidents(raw: unknown): VehicleIncident[] {
  const rows = Array.isArray(raw) ? raw : []
  return sortIncidents(rows.map(parseIncident).filter((row): row is VehicleIncident => row !== null))
}

/**
 * The report that keeps a trip's truck from moving on to another stop, if any: the
 * trip's latest one, while it says the vehicle cannot continue and the warehouse has
 * not cleared it, or once the warehouse sent the truck for repair. The server applies
 * the same rule to "Mark Arrived" (backend/core/incident_lifecycle.py).
 */
export function vehicleStoppedBy(tripIncidents: readonly VehicleIncident[]): VehicleIncident | null {
  const latest = [...tripIncidents].sort((a, b) => timeOf(b.reportedAt) - timeOf(a.reportedAt))[0]
  if (!latest) return null
  if (latest.isOpen && !latest.vehicleCanContinue) return latest
  if (!latest.isOpen && latest.resolutionOutcome === 'SENT_FOR_REPAIR') return latest
  return null
}

/** What the driver is told while `vehicleStoppedBy` holds them; matches the server's refusal. */
export function vehicleStoppedMessage(incident: Pick<VehicleIncident, 'isOpen'>): string {
  return incident.isOpen
    ? 'Your vehicle was reported unable to continue. Wait for the warehouse to send another truck, cancel the trip, or clear this vehicle to continue.'
    : 'Your vehicle was sent for repair. Wait for the warehouse to send another truck or cancel the trip.'
}

/** Whether the incident happened where the vehicle is now, by this margin. */
export const INCIDENT_NEAR_VEHICLE_METERS = 150

function metersBetween(a: [number, number], b: [number, number]): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180
  const dLat = toRad(b[0] - a[0])
  const dLng = toRad(b[1] - a[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** The part of an incident the map popups and icons need. */
export type IncidentMarkerInfo = {
  id: string
  incidentNumber: string
  type: VehicleIncidentType
  typeLabel: string
  tone: IncidentTone
  status: VehicleIncidentStatus
  progressLabel: string
  vehicleCanContinue: boolean
  description: string
  reportedAt: string
  tripNumber: string
  locationSource: VehicleIncidentLocationSource | null
  locationRecordedAt: string | null
}

export function incidentMarkerInfo(incident: VehicleIncident): IncidentMarkerInfo {
  return {
    id: incident.id,
    incidentNumber: incident.incidentNumber,
    type: incident.type,
    typeLabel: incidentTypeLabel(incident.type),
    tone: incidentTone(incident.type),
    status: incident.status,
    progressLabel: incidentProgressLabel(incident),
    vehicleCanContinue: incident.vehicleCanContinue,
    description: incident.description,
    reportedAt: incident.reportedAt,
    tripNumber: incident.tripNumber,
    locationSource: incident.locationSource,
    locationRecordedAt: incident.locationRecordedAt,
  }
}

type MapLocation = { id: string; lat: number; lng: number; markerType?: string }

/** The warning pin at the spot an incident was reported. */
export type IncidentSiteMarker = {
  id: string
  driverName: string
  vehiclePlate: string
  lat: number
  lng: number
  status: string
  markerType: 'incident'
  markerLabel: string
  incident: IncidentMarkerInfo
}

/**
 * Flag the vehicles that have an open incident, on the trucks the tracking pages
 * already built (`driver-<driverId>`, or `driver-<tripId>` for a trip with no
 * driver id). The truck carries the alert wherever the vehicle is now; a warning
 * pin marks the reported spot when the vehicle is not on the map or has since
 * moved more than `nearMeters` away from it.
 */
export function withIncidentMarkers<T extends MapLocation>(
  locations: readonly T[],
  incidents: readonly VehicleIncident[],
  nearMeters = INCIDENT_NEAR_VEHICLE_METERS,
): Array<(T & { incident?: IncidentMarkerInfo }) | IncidentSiteMarker> {
  const result: Array<(T & { incident?: IncidentMarkerInfo }) | IncidentSiteMarker> = [...locations]
  const flaggedTrucks = new Set<string>()
  // Newest first, so a vehicle with two open incidents (on two trips) shows the latest.
  for (const incident of sortIncidents(incidents)) {
    if (!incident.isOpen) continue
    const info = incidentMarkerInfo(incident)
    const truckIndex = result.findIndex(
      (location) =>
        location.markerType === 'truck' &&
        (location.id === `driver-${incident.driverId}` || location.id === `driver-${incident.tripId}`)
    )
    const truck = truckIndex >= 0 ? (result[truckIndex] as T & { incident?: IncidentMarkerInfo }) : null
    if (truck && !flaggedTrucks.has(truck.id)) {
      flaggedTrucks.add(truck.id)
      result[truckIndex] = { ...truck, incident: info }
    }
    if (incident.latitude === null || incident.longitude === null) continue
    const site: [number, number] = [incident.latitude, incident.longitude]
    if (truck && metersBetween([truck.lat, truck.lng], site) <= nearMeters) continue
    result.push({
      id: `incident-${incident.id}`,
      driverName: incident.driverName,
      vehiclePlate: incident.vehiclePlate,
      lat: site[0],
      lng: site[1],
      status: incident.status,
      markerType: 'incident',
      markerLabel: `${info.typeLabel} reported here`,
      incident: info,
    })
  }
  return result
}

/** Where the reported position came from, in words, for the popups and the panel. */
export function incidentLocationNote(
  incident: Pick<VehicleIncident, 'latitude' | 'longitude' | 'locationSource' | 'locationRecordedAt'>,
  formatTime: (iso: string) => string = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
): string {
  if (incident.latitude === null || incident.longitude === null) return 'No GPS position was available when this was reported'
  const at = incident.locationRecordedAt ? ` at ${formatTime(incident.locationRecordedAt)}` : ''
  return incident.locationSource === 'LAST_GPS'
    ? `Driver's last GPS update${at}`
    : `Driver's phone when reporting${at}`
}

/** A fresh retry key for one report; reused for every retry of that same report. */
export function newIncidentRequestId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (cryptoApi?.randomUUID) return `incident-${cryptoApi.randomUUID()}`
  return `incident-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}
