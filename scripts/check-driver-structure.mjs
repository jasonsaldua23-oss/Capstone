// Structural comparison between the web driver portal and the Expo driver app.
//
// The parity standard is "similar structure", not identical pixels or wording, so
// this reports the ordered sequence of sections each screen renders and pairs them
// up. It answers: does the app show the same things, per screen?
//
// Unlike the customer app, the driver app renders every screen from one App.tsx, so
// each screen's app side is a *region* of that file rather than a file of its own.
// A whole-file scan would report every screen as containing every other screen's
// copy, which would make the comparison meaningless. If App.tsx is ever split into
// per-screen files, replace the region specs with plain paths.
//
//   node scripts/check-driver-structure.mjs [screen]

import { reportParity } from "./lib/portal-parity.mjs";

const APP = "mobile/driver-app/App.tsx";

// Regions of App.tsx, delimited by the branch markers that separate the screens.
const region = (from, ...until) => ({ file: APP, from, until });

const LOGIN = region("styles.authShell", "<AppHeader");
const HOME = region('activeTab === "home" ? (', 'activeTab === "trips"');
const TRIPS = region('activeTab === "trips" ? (', "selectedTrip && isTripDetailOpen ? (");
const TRIP_DETAIL = region("selectedTrip && isTripDetailOpen ? (", 'activeTab === "history"');
const HISTORY = region('activeTab === "history" ? (', 'activeTab === "profile"');
const PROFILE = region('activeTab === "profile" ? (', "<BottomNavigation");
// Every modal — notifications, security, license, change password, POD camera —
// sits between the bottom navigation and the helper components.
const MODALS = region("<ModalShell", "function AppHeader(");

const APP_HEADER = region("function AppHeader(", "function MetricCard(");
const METRIC_CARD = region("function MetricCard(", "function HistoryDetails(");
// StatusPill sits just above HistoryDetails and is part of the same screens.
const HISTORY_DETAILS = region("function StatusPill(", "function getReturnableContainers(");
// The POD thumbnail and its "View Delivery Photo" caption live in this component.
const IMAGE_PREVIEW = "mobile/driver-app/src/components/ui/image-preview.tsx";
const DROP_POINT_CARD = region("function DropPointCard(", "function InfoRow(");
// PasswordRequirements sits just above InfoRow and belongs to the profile screens.
const PROFILE_ROWS = region("function OtpScreen(", "function ModalShell(");
const MODAL_SHELLS = region("function ModalShell(", "function BottomNavigation(");
const BOTTOM_NAV = region("function BottomNavigation(", "function getInitials(");
// The tab labels are props on the <BottomNavigation> element, not inside its body.
const BOTTOM_NAV_ITEMS = region("<BottomNavigation", "<ModalShell");

// The map, its controls and the navigation readouts live in their own component.
const NAV_MAP = "mobile/driver-app/src/components/DriverNavigationMap.tsx";

// Each pair is one driver-facing screen.
const SCREENS = [
  ["Login", "src/components/auth/DriverLoginPage.tsx", [LOGIN, MODALS]],
  ["Home", "src/components/portals/driver/sections/home/home-view.tsx", [HOME, METRIC_CARD]],
  ["Trips", "src/components/portals/driver/sections/trips/trips-list-view.tsx", [TRIPS]],
  ["Trip Detail", "src/components/portals/driver/sections/trips/trip-detail-view.tsx", [
    TRIP_DETAIL,
    DROP_POINT_CARD,
    MODALS,
    MODAL_SHELLS,
    NAV_MAP,
  ]],
  ["History", "src/components/portals/driver/sections/history/history-view.tsx", [HISTORY, HISTORY_DETAILS, IMAGE_PREVIEW]],
  ["Profile", "src/components/portals/driver/sections/profile/profile-view.tsx", [PROFILE, PROFILE_ROWS, MODALS]],
  ["Header", "src/components/portals/driver/sections/layout/portal-header.tsx", [APP_HEADER]],
  ["Bottom Nav", "src/components/portals/driver/sections/layout/bottom-nav.tsx", [BOTTOM_NAV, BOTTOM_NAV_ITEMS]],
  ["Camera Gate", "src/components/portals/driver/sections/layout/native-camera-gate-dialog.tsx", [MODALS]],
];

// Web labels the app deliberately renders differently. Each entry is a decision,
// not a gap — anything NOT listed here that goes absent is real drift worth seeing.
// Every entry below was checked against App.tsx by hand; the app renders the same
// thing under different wording, or the affordance does not apply on a phone.
const INTENTIONAL = {
  // The web splits the wordmark across two spans; the app renders it as one string.
  Header: ["AAB", "TRADING DRIVER"],
  // An aria-label on the web <nav>; the native tab bar needs no equivalent.
  "Bottom Nav": ["Navigation"],
  // The app words its empty states differently: "No active trip right now." and
  // "No active assigned trips match your search."
  Trips: ["No active deliveries", "No deliveries found"],
  "Trip Detail": [
    // App: "Returned Empty Bottles".
    "Return Empties",
    // App: "Customer Details" is not a heading; the stop card shows the customer,
    // address and phone directly, and Call Contact dials the number.
    "Customer Details", "Name:", "Phone:", "Address:", "Coordinates:",
    // App: a native Alert, not an in-page dialog.
    "Location Access Required",
    // The app pushes and pops screens; there is no dialog to close.
    "Close", "Back to trips",
    // Rendered from a template literal — `Total Price: ${formatPeso(...)}` — so the
    // scanner cannot see it as a literal, but the amber strip is there.
    "Total Price:",
    // Map controls, worded for a screen reader in DriverNavigationMap:
    // "Turn voice guidance on/off", "Recenter navigation", "Switch to 3D map".
    "Voice", "Recenter map to driver location", "Toggle 3D View",
    // App: a native Alert — "Permission Required" / "Allow camera access to attach
    // proof of delivery." — instead of the web's in-page camera recovery panel.
    "Camera Permission Required", "Try Open Settings", "Retry Camera", "Try Again",
    "Continue", "Manual steps", "Capture Photo",
    // App: "Capture proof of delivery photo" in the Complete Delivery sheet.
    "Capture POD Photo",
    // App confirmations are native Alerts: "Confirm Arrival", "Confirm Delivered",
    // "Confirm Reschedule".
    "Confirm Mark Arrived", "Confirm Arrived", "Confirm Mark as Delivered",
    "Confirm Action", "This will mark the trip as", "IN PROGRESS",
    // App: "Cannot Deliver" opens the failure sheet; the date field is "YYYY-MM-DD"
    // and the reason field is "Reason delivery failed".
    "Failed Delivery", "Reschedule", "Other date", "Select delivery date",
    "Cancellation reason (required)",
    // App: "Tomorrow" is a config tuple — ["tomorrow", "Tomorrow"] — not a literal
    // the scanner can see in JSX.
    "Tomorrow",
    // App: the map header reads "Exact: {lat}, {lng}", matching the phone layout.
    "Exact Driver Location:",
    // App: the sheet eyebrow is "DROP POINTS"; the counter reads "0/1 Delivered"
    // where the web says "Completed".
    "Trip drop points", "Completed",
  ],
  History: [
    // App: "Trip Details" / "Delivery History" headers with a native back gesture.
    "Back to", "Back to Delivery History",
    // App: "Customer: {name} · {phone}" rather than separate labelled rows.
    "Customer", "Phone", "Delivery Address",
  ],
  Profile: [
    // App: "First name" / "Middle name (optional)" / "Last name" / "Suffix (optional)".
    "Middle Name", "Suffix", "Phone Number", "Email Address",
    // App: "License expiry YYYY-MM-DD".
    "License Expiry Date",
    // App: one "Choose Profile Photo" action offering Take Photo / Choose Photo.
    "Change Avatar", "Upload profile photo",
    // App: confirmed with a native Alert titled "OTP Verified Successfully", which
    // lives in the handler rather than in the rendered screen.
    "OTP Verified Successfully",
  ],
  // App: a native Alert — "Allow camera access to attach proof of delivery."
  "Camera Gate": ["Camera Access Required", "Open App Settings"],
};

const only = process.argv[2]?.toLowerCase();
const mismatches = reportParity({ screens: SCREENS, intentional: INTENTIONAL, only });

console.log(`\nScreens with sections missing from the app: ${mismatches}`);
process.exit(mismatches > 0 ? 1 : 0);
