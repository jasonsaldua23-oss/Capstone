export const DRIVER_GPS_MAX_USABLE_ACCURACY_METERS = 250;
export const DRIVER_GPS_MAX_JUMP_METERS = 180;
export const DRIVER_GPS_MAX_REALISTIC_SPEED_MPS = 45;

export type LocationSample = {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  recordedAt?: number | null;
};

export function normalizeStatus(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/[\s-]+/g, "_")
    .toUpperCase();
}

export function getStartBlockedOrders(trip: any): string[] {
  // Keep the mobile start guard identical to the web portal and backend rule.
  return (Array.isArray(trip?.dropPoints) ? trip.dropPoints : [])
    .filter((point: any) => point?.order)
    .filter((point: any) => !["LOADED", "DISPATCHED"].includes(normalizeStatus(point.order?.warehouseStage)))
    .map((point: any) => String(point.order?.orderNumber || point.order?.id || "Unknown order"));
}

export function isTripScheduledToday(trip: any, today: Date = new Date()): boolean {
  const rawSchedule = String(trip?.tripSchedule || trip?.plannedStartAt || "").trim();
  if (!rawSchedule) return false;
  const scheduledAt = new Date(rawSchedule);
  if (Number.isNaN(scheduledAt.getTime())) return false;
  return scheduledAt.getFullYear() === today.getFullYear()
    && scheduledAt.getMonth() === today.getMonth()
    && scheduledAt.getDate() === today.getDate();
}

export function buildTripSearchText(trip: any): string {
  const values: unknown[] = [
    trip?.tripNumber,
    trip?.status,
    trip?.driver?.name,
    trip?.driver?.user?.name,
    trip?.vehicle?.licensePlate,
    trip?.vehicle?.type,
  ];

  for (const point of Array.isArray(trip?.dropPoints) ? trip.dropPoints : []) {
    values.push(
      point?.locationName,
      point?.address,
      point?.city,
      point?.province,
      point?.contactName,
      point?.contactPhone,
      point?.order?.orderNumber,
      point?.order?.shippingName,
      point?.order?.shippingAddress,
      point?.order?.shippingCity,
      point?.order?.shippingProvince,
    );
  }

  return values.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean).join(" ");
}

export function haversineMeters(from: LocationSample, to: LocationSample): number {
  const radiusMeters = 6_371_000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const deltaLatitude = toRadians(to.latitude - from.latitude);
  const deltaLongitude = toRadians(to.longitude - from.longitude);
  const latitude1 = toRadians(from.latitude);
  const latitude2 = toRadians(to.latitude);
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2;
  return radiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isUsableLocationSample(next: LocationSample, previous?: LocationSample | null): boolean {
  if (!Number.isFinite(next.latitude) || !Number.isFinite(next.longitude)) return false;
  if (Math.abs(next.latitude) > 90 || Math.abs(next.longitude) > 180) return false;
  if (typeof next.accuracy === "number" && next.accuracy > DRIVER_GPS_MAX_USABLE_ACCURACY_METERS) return false;
  if (!previous) return true;

  const distance = haversineMeters(previous, next);
  if (distance <= DRIVER_GPS_MAX_JUMP_METERS) return true;

  const elapsedSeconds = Math.max(0.001, ((next.recordedAt || Date.now()) - (previous.recordedAt || Date.now())) / 1000);
  return distance / elapsedSeconds <= DRIVER_GPS_MAX_REALISTIC_SPEED_MPS;
}

export function getAssignedVehicleSymbol(vehicle?: { type?: string | null } | null): string {
  const type = String(vehicle?.type || "").toLowerCase();
  if (type.includes("tricycle") || type.includes("three wheel")) return "🛺";
  if (type.includes("motorcycle") || type.includes("bike")) return "🏍️";
  if (type.includes("truck")) return "🚚";
  return "🚐";
}

export function mergeQueuedOperation<T extends { kind: string }>(queue: T[], item: T): T[] {
  // Location updates are state snapshots; delivery mutations must retain FIFO ordering.
  return item.kind === "LOCATION" ? [...queue.filter((entry) => entry.kind !== "LOCATION"), item] : [...queue, item];
}
