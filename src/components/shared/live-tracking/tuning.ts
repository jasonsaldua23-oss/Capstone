export const NAV_CAMERA_LOOKAHEAD_METERS = 95;

const NAV_CAMERA_ANIMATION_SECONDS = 0.35;

// A fix arriving after this long a silence is shown at once rather than glided
// to: the journey in between is unknown and the tab was likely in the background.
export const TRUCK_SNAP_AFTER_SILENCE_MS = 60000;

export const TRUCK_STATIONARY_THRESHOLD_METERS = 1.5;

// Beyond this distance from the active route the driver is treated as off-route
// (a missed turn or a self-chosen detour). The icon then follows the live GPS
// position instead of being pinned to the stale route — this is what stops the
// vehicle from freezing when the driver changes roads, until the reroute lands.
export const TRUCK_MAX_ROUTE_SNAP_METERS = 45;

export const TRUCK_ROUTE_LOOKAHEAD_METERS = 20;

export const TRUCK_LOCAL_TANGENT_LOOKAHEAD_METERS = 8;
