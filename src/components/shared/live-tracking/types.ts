export type DriverLocationPopupItem = {
  name: string;
  qty: string;
};

export type DriverLocation = {
  id: string;
  driverName: string;
  vehiclePlate: string;
  lat: number;
  lng: number;
  actualLat?: number;
  actualLng?: number;
  status: string;
  markerColor?: string;
  markerLabel?: string;
  markerDirection?: 'left' | 'right';
  markerHeading?: number;
  markerType?: 'pin' | 'dot' | 'truck' | 'default';
  markerNumber?: number | string;
  markerEta?: string;
  markerEtaPhase?: 'completed' | 'next' | 'upcoming';
  accuracyMeters?: number;
  // Ground speed in m/s from the GPS fix. The navigation view predicts with it
  // between fixes, and every map uses it to tell a parked vehicle from a moving one.
  speedMps?: number;
  // When the phone took the fix (epoch ms) and the bearing it reported. The report
  // maps judge each report against the ones before it with these, so a late or
  // repeated report cannot move the vehicle back and a Wi-Fi fix cannot pull it
  // off its road. `markerHeading` is not the GPS bearing on those maps.
  recordedAtMs?: number;
  gpsHeading?: number;
  routeProgressMeters?: number;
  // The id of the route line this truck is on, drawn from its position onward. On
  // the maps that learn positions a report at a time it is drawn along that road.
  roadLineId?: string;
  popupCustomerName?: string;
  popupAddress?: string;
  popupOrderItems?: DriverLocationPopupItem[];
  assignedTripNumber?: string;
  destinationCustomer?: string;
};

export type LiveRouteLine = {
  id: string;
  points: [number, number][];
  color: string;
  label?: string;
  opacity?: number;
  weight?: number;
  dashArray?: string;
  snapToRoad?: boolean;
  // The road this truck has taken. On the report maps it ends at the truck's icon
  // and is drawn above the route still ahead of it.
  followsTruckId?: string;
  preserveExactEndpoints?: boolean;
  selectable?: boolean;
};

export type SnappedPointOnRoute = {
  point: [number, number];
  t: number;
  distance2: number;
  heading: number;
  segmentIndex: number;
};

export type TruckIconDirection = 'left' | 'right';
