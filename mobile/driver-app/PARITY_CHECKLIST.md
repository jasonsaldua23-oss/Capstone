# Driver Portal React Native parity checklist

The existing React.js Driver Portal is the read-only source of truth. This checklist maps its mobile flows to the independent React Native application in `mobile/driver-app`.

## Authentication

- [x] Driver-only email/password login using `/api/auth/login` and `portal: "driver"`
- [x] Remember-me selection and protected native credential storage
- [x] Server validation before restoring a remembered session
- [x] Login OTP challenge, verification, and resend flow
- [x] Forgot-password email, OTP verification, password policy, and reset flow
- [x] Show/hide password, API timeout errors, loading states, and logout
- [x] Web Driver logo asset copied unchanged and used by the app and app icon

## Portal navigation and dashboard

- [x] Home, Trips, History, and Profile bottom navigation
- [x] Header branding, notification action, unread indicator, and mobile safe areas
- [x] Dedicated trip-detail screen state hides the portal header and bottom navigation
- [x] Today's Total Trips, Planned, Completed, and Pending Stops calculations
- [x] Current assignment, assigned orders, loading, empty, error, refresh, and offline states

## Trips and delivery workflow

- [x] Assigned-trip retrieval, search, active/completed filtering, and trip selection
- [x] Start-trip inventory readiness guard and confirmation
- [x] Warehouse, vehicle, schedule, notes, drop points, orders, products, mixed cases, and replacements
- [x] Arrived status update
- [x] Mandatory camera/gallery proof-of-delivery upload and delivered status update
- [x] Returned-container quantity payload
- [x] Cannot-deliver reason, tomorrow/custom-date rescheduling, cancellation, and final warning
- [x] Cancellation inventory-release and reschedule route-planning payloads
- [x] Offline mutation queue and ordered replay without discarding delivery operations

## Native map, tracking, and navigation

- [x] Native MapLibre map; no browser map embedded in Android/iOS
- [x] OSRM full-trip driving geometry and maneuver steps
- [x] Warehouse/trip origin plus ordered pickup/drop-off/destination markers
- [x] Driver GPS and account-scoped latest-location fallback
- [x] Foreground and background location tracking linked to the active trip
- [x] GPS accuracy, impossible-speed, jump, and stationary-noise filtering
- [x] Truck position projected onto the existing road polyline
- [x] Eased interpolation between accepted GPS updates
- [x] Bearing calculation and shortest-angle heading interpolation
- [x] Monotonic route progress so GPS noise cannot move the completed line backward
- [x] Completed road geometry in gray and remaining geometry in the active route color
- [x] Smooth follow camera, zoom, recenter, 2D/3D, and voice-guidance controls
- [x] Distance and estimated time remaining
- [x] Transient OSRM failures retain the last successful route

## History, profile, security, and notifications

- [x] Completed-trip search and pagination
- [x] Three-level history navigation: trips, trip drop points/orders, order details
- [x] Customer/address, POD, product/size, mixed-case component, failure, and total details
- [x] Profile summary, avatar selection/upload, contact information, and license data
- [x] First, middle, last, and suffix profile fields matching the backend/web payload
- [x] 2FA and login-alert server settings plus remember-device local setting
- [x] Password OTP verification and password-policy validation
- [x] Notification list, unread count, mark-all-read, clear-all, and preferences
- [x] Warehouse, inventory, and user-administration notifications excluded from the driver feed

## Compatibility and verification

- [x] Mobile dependencies and native configuration remain inside `mobile/driver-app`
- [x] Existing web Driver Portal files are not imported into or modified for the native app
- [x] Existing backend endpoints and request payloads are reused without backend changes
- [x] TypeScript check passes (`npm run typecheck`)
- [x] Driver logic and route projection tests pass (`npm test`, 11 tests)
- [ ] Physical Android/iOS device visual comparison and live road test (requires a device, GPS movement, and production credentials)

