# Spec: Mobile Driver App Web-Portal Parity

**Author:** Codex, based on the user-provided completion brief and repository audit  
**Date:** 2026-08-19  
**Status:** Approved  
**Source of truth:** Existing web driver portal and active Django API contracts

## Context

The Expo driver app currently provides authentication, a summary, assigned-trip cards, one-time location sharing, history, and profile editing. It does not yet provide the operational delivery workflow available in the web driver portal: continuous tracking, route guidance, stop transitions, proof of delivery, failure/rescheduling flows, notification management, or offline recovery.

This feature makes the native driver app functionally equivalent to the complete web driver portal while preserving the web portal and backend as the source of truth. Existing APIs, authorization, trip state rules, order data, and profile behavior must be reused. Native capabilities may improve the mobile interaction, but must not introduce a conflicting workflow.

## Functional Requirements

- FR-1: The app MUST authenticate only staff accounts whose role is `DRIVER` and MUST honor the existing “Keep me logged in” preference.
- FR-2: The app MUST restore a remembered session only when both the persisted preference and valid driver session data exist.
- FR-3: The app MUST display Home, Trips, History, and Profile as the primary bottom navigation destinations.
- FR-4: Home MUST show today’s operational counts for active trips, planned trips, completed trips, and pending stops using the same trip payloads as the web portal.
- FR-5: Home MUST show assigned orders and MUST allow a `PLANNED` trip to start only when every assigned order has warehouse stage `LOADED` or `DISPATCHED`.
- FR-6: Trips MUST list only non-completed assigned trips and MUST support case-insensitive search by trip number, status, vehicle, driver, stop, customer, address, and order number.
- FR-7: History MUST list only completed trips and MUST support search and incremental pagination.
- FR-8: Trip details MUST show the trip schedule, assigned vehicle, warehouse/start point, ordered stops, customer/contact data, full delivery address, order number, order contents, replacement data, notes, and latest GPS state when present in the API.
- FR-9: A driver MUST be able to transition a pending stop to `ARRIVED` after confirmation.
- FR-10: A driver MUST be able to complete an arrived stop only after capturing or selecting an image and successfully uploading proof of delivery.
- FR-11: Completion MUST submit the recipient name, proof image URL, notes, and returned-empty count supported by the existing stop-update contract.
- FR-12: A driver MUST be able to report failed delivery with a reason and choose later today, tomorrow, another date, or cancellation.
- FR-13: “Later today” MUST submit `FAILED` with `rescheduleRequested=true` and `rescheduleWindow=today`, allowing the backend to return the stop to `PENDING` at the route end.
- FR-14: Tomorrow or another date MUST keep inventory reserved and requeue the order through the existing backend rescheduling workflow.
- FR-15: Cancellation MUST release inventory through the existing backend cancellation workflow.
- FR-16: The app MUST request foreground location permission before starting a trip and SHOULD request background permission for continued active-trip tracking.
- FR-17: While an assigned trip is active, the app MUST collect location updates in foreground and background and submit latitude, longitude, accuracy, heading, speed, altitude, and trip ID to `/api/driver/location`.
- FR-18: The app MUST reject GPS samples with accuracy worse than 250 metres and MUST reject physically implausible jumps greater than 180 metres when they imply speed greater than 45 metres/second.
- FR-19: The app MUST send an active-trip location heartbeat no less frequently than every 5 seconds while the app is in the foreground when a usable last position exists.
- FR-20: The app MUST stop trip-specific background tracking when no assigned trip remains active or when the driver logs out.
- FR-21: The trip screen MUST provide MapLibre-native route rendering with a pitched navigation camera, remaining route, completed route, warehouse/stop markers, and the current assigned vehicle marker.
- FR-22: The moving marker MUST depict the assigned vehicle; tricycle assignments MUST use a tricycle marker and MUST NOT be represented by a generic arrow or dot.
- FR-23: The app MUST obtain turn-by-turn route geometry and steps from the same OSRM driving endpoint used by the web portal.
- FR-24: The app MUST display the current maneuver, street name, remaining maneuver distance, remaining trip distance, and estimated remaining duration when OSRM supplies those values.
- FR-25: Voice guidance MUST be enabled by default, MUST be toggleable, MUST speak English navigation prompts, and MUST avoid repeatedly announcing the same prompt threshold.
- FR-26: A driver MUST be able to recenter the navigation camera and change zoom while navigation is active.
- FR-27: Failed OSRM requests MUST retain the last successful route and MUST NOT block stop-management actions.
- FR-28: Mutating driver operations attempted without connectivity MUST be stored in a durable on-device FIFO queue.
- FR-29: Queued operations MUST be retried when connectivity returns and MUST be removed only after a successful server response.
- FR-30: Queue conflicts or permanent 4xx errors MUST remain visible to the driver and MUST NOT be silently discarded.
- FR-31: The app MUST retrieve the authenticated driver’s notification feed, unread count, mark-all-read action, and clear-all action from `/api/notifications`.
- FR-32: Local trip, delivery, and system notification preferences MUST remain configurable on the device.
- FR-33: Profile MUST display and edit the same driver name, phone, emergency contact, license number, license type, and license expiry data as the web portal.
- FR-34: Account Security MUST preserve the existing OTP password reset workflow and local security preferences exposed by the web portal.
- FR-35: The app MUST show explicit loading, empty, permission-denied, offline, queued, retrying, and API-error states instead of placeholder content.
- FR-36: The app MUST use the existing API and database records; it MUST NOT create a duplicate driver, trip, order, stop, notification, or POD data store.

## Non-Functional Requirements

- NFR-1: Authenticated API calls MUST include the persisted bearer token and MUST treat HTTP 401 as an expired session that requires login.
- NFR-2: API calls MUST have a 15-second timeout and retry only network failures or 5xx responses; validation and authorization 4xx responses MUST not be retried automatically.
- NFR-3: POD uploads MUST use multipart form data and MUST not force a JSON content type.
- NFR-4: Offline queue entries MUST persist across application restarts until successfully synchronized or explicitly superseded by a newer location update.
- NFR-5: Background location MUST use the platform foreground-service/background-mode configuration required by Expo SDK 53.
- NFR-6: Navigation controls and stop actions MUST expose accessibility labels and a minimum 44-by-44 point touch target.
- NFR-7: Operational text MUST remain readable at the platform’s enlarged text settings without hiding the primary action.
- NFR-8: No production secret or proprietary map access token MUST be embedded in the mobile bundle.
- NFR-9: The implementation MUST type-check with the project TypeScript compiler and MUST pass its mobile unit tests.
- NFR-10: The existing web driver portal MUST remain unchanged unless a verified API-contract defect makes a small compatibility change necessary.

## Acceptance Criteria

### AC-1: Remembered driver session (FR-1, FR-2, NFR-1)
Given a driver selected “Keep me logged in” and completed login successfully  
When the application is terminated and opened again  
Then the stored driver session is restored and the Home screen is shown  
And a non-driver stored session is rejected.

### AC-2: Non-remembered session (FR-1, FR-2)
Given a driver logged in with “Keep me logged in” disabled  
When the application is opened in a new run  
Then the login screen is shown  
And stale token and user records are removed.

### AC-3: Trip start guard (FR-5, FR-16)
Given a planned assigned trip contains an order whose warehouse stage is neither `LOADED` nor `DISPATCHED`  
When the driver taps Start Trip  
Then no start request is submitted  
And the app identifies the unloaded order.

### AC-4: Trip starts with tracking (FR-5, FR-16, FR-17)
Given a planned trip has only loaded or dispatched orders and foreground location permission is granted  
When the driver confirms Start Trip  
Then `/api/trips/{tripId}/start` is called with the current coordinates  
And location tracking starts for that trip  
And refreshed trip status is `IN_PROGRESS`.

### AC-5: Arrive at stop (FR-9)
Given an in-progress trip has a pending stop  
When the driver confirms arrival  
Then the app PATCHes the stop with status `ARRIVED`  
And the refreshed stop displays its actual arrival time.

### AC-6: POD required (FR-10, NFR-3)
Given an arrived stop has no proof image  
When the driver attempts to mark it delivered  
Then no completion request is made  
And the app asks the driver to capture or select proof.

### AC-7: Complete delivery (FR-10, FR-11, NFR-3)
Given an arrived stop has a selected image and recipient name  
When the driver confirms delivery  
Then the image is uploaded as multipart form data to `/api/uploads/pod-image`  
And the returned image URL is submitted with status `COMPLETED`  
And the refreshed order is delivered.

### AC-8: Reschedule later today (FR-12, FR-13)
Given a delivery cannot be completed today at the current time  
When the driver selects “Later today” and supplies a reason  
Then the failed-stop request includes `rescheduleRequested=true`, `rescheduleWindow=today`, and `releaseInventory=false`  
And the refreshed stop is pending at the end of the route.

### AC-9: Reschedule another date (FR-12, FR-14)
Given a delivery cannot be completed and a valid future date is selected  
When the driver confirms rescheduling  
Then the request includes that ISO date and `releaseInventory=false`  
And the backend response reports the order requeued to the route pool.

### AC-10: Cancel failed delivery (FR-12, FR-15)
Given a failed delivery must be cancelled  
When the driver confirms cancellation with a reason  
Then the request sets a terminal failed/cancelled outcome and releases inventory  
And the refreshed order is cancelled.

### AC-11: GPS filtering (FR-18)
Given a last accepted location exists  
When a new sample is less accurate than 250 metres or represents an implausible jump above 45 metres/second  
Then the sample is not displayed or uploaded  
And the last accepted location remains active.

### AC-12: Background tracking lifecycle (FR-17, FR-19, FR-20, NFR-5)
Given background permission is granted and an assigned trip is in progress  
When the app moves to the background  
Then the registered Expo location task continues collecting trip-linked updates  
And tracking stops after the trip is no longer active or the driver logs out.

### AC-13: Native route guidance (FR-21, FR-22, FR-23, FR-24)
Given an in-progress trip has a current GPS position and at least one pending geocoded stop  
When the trip navigation screen opens  
Then MapLibre displays the OSRM route in a pitched camera  
And shows the assigned vehicle marker, using a tricycle for a tricycle assignment  
And displays the current maneuver and remaining route metrics.

### AC-14: Voice guidance (FR-25)
Given route steps exist and voice guidance is enabled  
When the driver crosses an announcement distance threshold  
Then one English prompt is spoken for that threshold  
And the same threshold is not spoken repeatedly.

### AC-15: Offline operation synchronization (FR-28, FR-29, FR-30, NFR-4)
Given the device has no network connection  
When the driver performs a supported mutation  
Then the operation is stored durably and shown as queued  
And after connectivity returns it is submitted in FIFO order  
And it is removed only after success.

### AC-16: Notifications (FR-31, FR-32)
Given authenticated driver notifications exist  
When the driver opens Notifications  
Then the API feed and unread count are displayed  
And Mark All Read and Clear All update the server-backed feed.

### AC-17: Profile parity (FR-33, FR-34)
Given the authenticated driver opens Profile  
When profile or license data is changed and saved  
Then `/api/driver/profile` is updated and the refreshed values are displayed  
And password change remains gated by a verified OTP.

### AC-18: Error state (FR-35, NFR-2)
Given an API request times out or returns an error  
When the operation ends  
Then the screen leaves its loading state  
And displays the server message or a safe network error  
And offers an applicable retry action.

### AC-19: Trip and history discovery (FR-6, FR-7, FR-8)
Given the driver has active and completed assigned trips  
When the driver searches Trips or History using a matching trip, vehicle, customer, address, stop, or order value  
Then only matching records from the appropriate active or completed collection are shown  
And opening a result displays all corresponding trip, vehicle, stop, order, and contact fields supplied by the API.

### AC-20: Navigation controls and route fallback (FR-26, FR-27)
Given a previously loaded navigation route is displayed  
When the driver changes zoom or recenters and a subsequent OSRM refresh fails  
Then the camera responds to the requested control  
And the last successful route remains displayed  
And stop actions remain enabled.

### AC-21: Shared server records (FR-36, NFR-10)
Given a trip or stop is changed successfully in the mobile app  
When the web driver portal next retrieves the same resource  
Then it displays the mobile-submitted server state  
And no mobile-only trip, stop, or delivery record is created.

## Edge Cases and Error Scenarios

- EC-1: Stored user exists without token or remember preference -> clear the incomplete session and show login.
- EC-2: Stored driver token receives 401 -> stop tracking, clear session data, and show login.
- EC-3: Location services disabled -> show a settings-oriented error; trip and stop details remain readable.
- EC-4: Foreground permission denied -> do not start tracking; explain that trip start requires location.
- EC-5: Background permission denied -> continue foreground tracking and show that background tracking is unavailable.
- EC-6: GPS accuracy exceeds 250 metres -> ignore the sample and retain the last accepted sample.
- EC-7: OSRM times out, returns non-JSON, or has no route -> retain the last route when available and leave delivery actions enabled.
- EC-8: A stop lacks coordinates -> show its details but exclude it from native routing and explain why navigation is unavailable.
- EC-9: Camera permission denied -> allow gallery selection and provide an application-settings action.
- EC-10: POD upload fails -> do not mark the stop completed; preserve the local proof draft for retry.
- EC-11: Offline completion is queued -> keep the stop visibly pending synchronization and prevent a second conflicting completion.
- EC-12: Server returns 400/403/404/409 for a queued action -> retain the failed queue item with the server message for user review.
- EC-13: Notification API fails -> retain local preferences, show feed error, and allow retry.
- EC-14: Profile API rejects duplicate license -> display the backend conflict message and keep the unsaved form.
- EC-15: App is force-terminated -> platform limitations may stop background GPS; the next launch must restore the active-trip tracking state.
- EC-16: Multipart response has no `imageUrl` -> treat upload as failed and do not complete delivery.

## API Contracts

All authenticated requests use `Authorization: Bearer <token>`. JSON requests use `Content-Type: application/json`; multipart POD uploads allow the runtime to set the boundary.

```typescript
interface ApiError {
  success?: false;
  error?: string;
  message?: string;
}

interface DriverLocationRequest {
  latitude: number;
  longitude: number;
  tripId?: string | null;
  accuracy?: number | null;
  heading?: number | null;
  speed?: number | null;
  altitude?: number | null;
  battery?: number | null;
}

GET /api/driver/trips?page=1&pageSize=50
response 200: { success: true; trips: DriverTrip[]; total?: number }

POST /api/trips/{tripId}/start
request: { latitude?: number | null; longitude?: number | null }
response 200: { success: true; trip: DriverTrip }

POST /api/driver/location
request: {
  latitude: number; longitude: number; tripId?: string | null;
  accuracy?: number | null; heading?: number | null;
  speed?: number | null; altitude?: number | null; battery?: number | null;
}
response 200: { success: true; locationLogId: string; tripIdUsed?: string | null }

PATCH /api/trips/{tripId}/drop-points/{dropPointId}
request: {
  status: "ARRIVED" | "COMPLETED" | "FAILED" | "SKIPPED" | "CANCELLED";
  notes?: string; recipientName?: string; deliveryPhoto?: string;
  failureReason?: string; failureNotes?: string; releaseInventory?: boolean;
  rescheduleRequested?: boolean; rescheduleWindow?: "today" | "tomorrow" | "other_date";
  rescheduleDate?: string; returnedEmpties?: number;
}
response 200: { success: true; dropPoint: DriverTripDropPoint; order?: object | null; requeuedToRoutePool?: boolean }

POST /api/uploads/pod-image
request: multipart/form-data with field `file`
response 200: { success: true; imageUrl: string }

GET /api/notifications?limit=100
response 200: { success: true; notifications: DriverNotification[]; unreadCount: number }

PATCH /api/notifications
request: { markAll: true } | { ids: string[] }
response 200: { success: true; updated: number; unreadCount: number }

DELETE /api/notifications
response 200: { success: true; deleted: number; unreadCount: 0 }

GET | PUT /api/driver/profile
response 200: { success: true; driver: DriverProfilePayload }
```

Standard errors may be 400 validation, 401 unauthenticated, 403 unauthorized/wrong driver, 404 missing resource, 409 conflict, or 500 unexpected server error, with `{ success?: false, error?: string, message?: string }`.

## Data Models

### LocalSession

| Field | Type | Constraints |
|---|---|---|
| token | string | Required for authenticated requests; removed on logout/401 |
| user | AuthUser | Must have role `DRIVER` |
| rememberMe | boolean | Session is restored only when true |

### DriverTrip

The mobile type mirrors the serialized Django trip: identity/number/status/timestamps, schedule, warehouse/start coordinates, driver, vehicle, latest location, counts, and ordered drop points. It is server-owned and not duplicated locally except as cached display state.

### DriverTripDropPoint

The mobile type mirrors the serialized stop: sequence/status/type, address/contact/coordinates, actual timestamps, POD/failure fields, and nested order. The server remains authoritative.

### OfflineQueueItem

| Field | Type | Constraints |
|---|---|---|
| id | string | Unique local identifier |
| kind | enum | `LOCATION`, `START_TRIP`, `UPDATE_STOP` |
| method | enum | `POST` or `PATCH` |
| path | string | Existing relative API path only |
| body | object | JSON-serializable request body |
| createdAt | ISO timestamp | Immutable; FIFO ordering |
| attempts | integer | Non-negative |
| lastError | string/null | Visible synchronization error |
| state | enum | `QUEUED`, `SYNCING`, `FAILED` |

### NavigationRoute

| Field | Type | Constraints |
|---|---|---|
| coordinates | `[longitude, latitude][]` | At least two points for line rendering |
| steps | OsrmStep[] | Normalized maneuver location/type/modifier/name/distance/duration |
| distance | number | Metres, non-negative |
| duration | number | Seconds, non-negative |

### DriverNotification

Mirrors the Django notification serializer: id, title, message, type/reference fields, read state/read timestamp, and creation timestamp. The server owns read/deletion state.

## Out of Scope

- OS-1: Changes to the web driver portal design or behavior; it is the reference implementation.
- OS-2: New backend tables or alternate mobile-only delivery statuses; existing Django contracts are sufficient.
- OS-3: A proprietary map-tile subscription or secret token; the app uses a public token-free style until deployment supplies an approved provider.
- OS-4: Guaranteed tracking after the user force-stops the app; Android and iOS impose platform limits outside application control.
- OS-5: Electronic signature capture; the current web workflow requires POD image, recipient name, notes, and returned empties, not a signature artifact.
- OS-6: Customer, warehouse, or administrator mobile workflows; this spec covers the driver application only.
