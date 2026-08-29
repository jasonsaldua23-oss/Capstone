# Plan: Mobile Customer App ↔ Web Customer Portal Parity

**Date:** 2026-08-29
**Status:** Draft — awaiting approval
**Source of truth:** `src/components/portals/customer/**` (web) and the active Django API contracts
**Target:** `mobile/customer-app/**` (Expo / React Native)

## 1. Context

Two "customer apps" exist in this repo:

1. **Capacitor wrapper** (`capacitor.config.ts`, variant `customer`) — a WebView pointed at
   `/login/customer`. This is already literally 1:1 with the web portal.
2. **Expo native app** (`mobile/customer-app`) — a separate React Native re-implementation
   (`App.tsx`, 3368 lines) that talks to the same Django API. This is the one that has drifted.

This plan targets (2). If byte-identical parity is the only goal and native capability is not
required, shipping (1) is the zero-drift option and this plan is unnecessary — that is a decision
to make before starting.

### Parity standard

React Native cannot reproduce the DOM/Tailwind layer exactly (no CSS grid, no `backdrop-blur`,
different shadow and text-metrics models, native pickers instead of `<select>` / `<input type=date>`).
"1 to 1" is therefore defined as:

- **Identical** information architecture, screen order, element order, copy, empty/loading/error
  states, colors, spacing scale, typography scale, iconography, and behavior.
- **Equivalent** rendering: the same design tokens expressed with native primitives.
- Any element the web portal does not have MUST be removed from the app, and vice versa.

## 2. Current gap analysis

### 2.1 Shell and navigation

| Area | Web | Mobile | Action |
|---|---|---|---|
| Header | eyebrow `ANN ANN'S BEVERAGES TRADING`, wordmark `AAB TRADING` + green ` SHOP`, cart button w/ count badge, bell w/ unread badge | same structure, but renders emoji glyphs (cart, bell) layered on top of the lucide icons, and the bell button doubles as the avatar | strip emoji glyphs; separate bell from avatar |
| Bottom nav | Home / Purchase Request / Purchase Order / Profile, emerald-50 active pill | same items, but emoji glyphs render beside the lucide icons | strip glyph text |
| Desktop rail | 240px left sidebar | `SideNavigation` present | verify styling parity |
| Detail routing | `order-detail`, `purchase-request-detail`, `edit-address` are **full pages** | detail renders as an inline card under the list; address is a modal | convert to pushed screens |

### 2.2 Home / catalog

Web-only, missing from mobile:

- `WelcomePopup` driven by `sessionStorage.customer_welcome_state`, with distinct new-account
  (`Welcome, {name}.`) vs returning (`Welcome back, {name}.`) copy and subtitle
  "Place your order and we will deliver it to your store."
- Category **dropdown** (mobile uses horizontal chips).
- Sold-out products sink below in-stock ones, under a `Sold Out` section heading, with a
  translucent circular `Sold Out` badge over the product image.
- `Package`-icon placeholder when `imageUrl` is absent.
- `PortalProductGridSkeleton` while loading.
- Category label line on the card.
- Desktop right rail: `Current Order (n items)` + `Edit`, per-line mixed-case components,
  `Total items` / `n units`, `Estimated Total`, `Continue to Checkout`.

Mobile-only, to remove: the `{sku} · {unit}` line on the product card, and the whole
"Cart summary" card with its `Open Cart` button and
"Review your cart and proceed to checkout from the next screen." copy.

### 2.3 Cart

Missing from mobile: back arrow; `Deliver to: {barangay, city, province}` header with `Edit Address`;
trash / `Remove selected items`; returnable-deposit indicator (`Recycle` icon +
`getMixedCaseDepositAmounts`); the sticky total bar (web renders it through a body portal);
web's exact empty-state copy.

### 2.4 Checkout

Missing from mobile: `Existing empty deposits applied` summary line; a real date picker
(mobile takes free-text `YYYY-MM-DD`); the post-order confirmation dialog; primary/secondary
delivery-address selection (`selectedDeliveryAddress`, which the web state carries in full).

### 2.5 Purchase Requests

Missing: pagination (prev/next with range label); `Requested Items`, `Container deposit`,
`Estimated Total` blocks; the dedicated detail page (`Order Note`, Product/Qty/Unit Price/Subtotal,
`Returnable-container deposit`, `Estimated Total`).

Mobile-only, to remove: the status chip row (web has no status filter here).

### 2.6 Purchase Orders

Missing: the four tabs `All / Delivered / To Review / Replacement`; the Filter dialog;
pagination (`PAGE_SIZE = 10`); the entire **Replacement** surface — `Replacement Details`,
`Replacement Items`, `Reason`, `Reported`, `Replacement Order:`, `Received By:`, `Submitted At:`,
`Proof of Delivery (POD)` image with `No POD uploaded yet.`, cancel-replacement, receive-return;
the `Rescheduled Order` badge; the review-details dialog; the full order-detail page
(`Order Note`, Product/Qty/Unit Price/Subtotal/Total, POD, `Request Replacement` with per-product
reason selection).

Mobile-only, to remove: the status chip row and the `Date from` / `Date to` text inputs.

### 2.7 Track

Missing: the green gradient stat strip (`Order Status` / `Order ID` or `Replacement ID` /
`Scheduled for`–`Expected on`–`Delivered on` + delivered time); the `RESCHEDULED ORDER` badge;
warehouse marker, completed-route styling and the two guard messages
("Waiting for live driver GPS for this order." / "Driver location is shown only when the order is
out for delivery."); `Delivery Journey` with per-step descriptions, timestamps, `Live updates`
badge and `PortalTimelineSkeleton`; the `Delivery Details` card (address + recipient,
`No. of Items` / `No. of Replacement Items`, `Total Amount`); the driver card with avatar and a
working call button.

Mobile-only, to remove: the tracking-order chip row and the `TRUCK` / `D` text markers
(web uses real markers).

### 2.8 Feedback and rating

Web uses a `Delivery Rating` **dialog** with star input, `Select Feedback`, the validation line
"Select at least one feedback option to submit your review.", and the footer
"Your feedback helps us improve our service"; the feedback list is titled `Your Feedback` with
"Use delivered orders to submit feedback." Mobile uses a numeric 1–5 button row on a full tab with
different copy. Rebuild as a dialog with stars and web copy.

### 2.9 Profile

| Web | Mobile |
|---|---|
| Edit Profile — First/Middle/Last/Suffix, Phone, Email Address, avatar upload **+ crop dialog** (zoom/drag) | fields present; **no crop dialog** |
| Account Security → Change Password (OTP) **and** Security Settings: `Two-Factor Authentication (2FA)`, `Login Activity Alerts`, `Remember Device Sessions` | OTP password change only — **all three toggles missing** |
| Notifications — list + Order/Delivery/System toggles | matches |
| Delivery Address → full Edit Address page: Contact Information (Full Name, Phone Number); Address Details (House number (optional), Street name, Subdivision (optional), Barangay, City / Municipality, Province, Postal code, Country); `Full Address Preview`; clear-fields | flat modal: Address / City / Province / ZIP / **hand-typed latitude & longitude** |
| Empties & Deposits — tabs `Available Empties` \| `Used / Reserved Deposits`, per-case vs per-bottle deposit value, `Select Purchased Beverage`, `Number of Cases to Return`, `Deposit Credit to Apply:`, `Total Locked Deposit Credit`, `Reserved in active orders:`, three distinct empty states, two loading states | single flat list, no tabs, no reserved deposits, no deposit-credit apply |
| Log Out | matches |

### 2.10 Address capture

Web has map-pin selection (`handlePinnedLocation`), service-area validation
(`handleOutsideServiceArea`), `useCurrentLocation`, Negros-Occidental-scoped search, and a
secondary address. Mobile has search only and manual lat/lng entry.

### 2.11 Receipt

Web: `ORDER RECEIPT` / `Official Delivery Receipt`, `Receipt No.`, `Order No.`,
Product/Qty/Unit Price/Amount table, `Subtotal`, `TOTAL PRICE`, "Thank you for your purchase.",
"This receipt serves as proof of payment and delivery." Mobile renders a reduced InfoRow layout.
Rebuild against the same markup, keeping `expo-print` + `expo-sharing` as the output path.

### 2.12 Mixed-case builder

Web dialog exposes `Case capacity`, `Product size`, `Number of cases`, `Capacity`, `Remaining`,
`Added`, `Estimated Mixed Case total` and deposit amounts. `MixedCaseBuilder.tsx` needs a
field-by-field audit against it.

### 2.13 Cross-cutting

- Loading: web uses skeletons; mobile uses plain text.
- Messaging: web uses `sonner` toasts; mobile uses inline error text and `Alert`.
- API surface missing on mobile: `/api/replacements/{id}/receive-return`,
  `/api/customer/replacements/{id}/cancel`, and the server-side query params on
  `/api/customer/orders`.
- Logic duplication: mobile re-derives status/stage/label logic in `src/lib/customer-logic.ts`
  (84 lines) instead of reusing web's helpers.

## 3. Approach

### 3.1 Share the logic, not the views

`src/components/portals/customer/sections/orders/order-status.ts`,
`orders/order-item-display.ts`, `shared/customer-common.ts` and
`src/components/portals/shared/mixed-case-deposit.ts` are pure TypeScript with no React or DOM
dependency. Move them to a `shared/customer-logic/` package consumed by both the Next.js app and
the Expo app (Metro `watchFolders` + a tsconfig path alias). This makes status normalization, stage
index, peso formatting, item labels and deposit math structurally impossible to drift.

`receipt-utils.ts` is DOM-bound (`html-to-image`) and stays web-only; the receipt *template* is
shared as data, rendered per platform.

### 3.2 Split `App.tsx`

Mirror the web folder layout so every web file has an obvious counterpart:

```
mobile/customer-app/src/screens/
  home/ cart/ checkout/ orders/ purchase-requests/ track/ profile/ feedback/ layout/
```

Nothing else makes a 3368-line single file reviewable against 20 web files.

### 3.3 Design tokens

`src/theme.ts` already mirrors the web palette. Extend it with the type scale, spacing, radii,
shadow and status-badge maps read out of the web components, and forbid raw hex in screens.

### 3.4 Navigation

Introduce a stack so `order-detail`, `purchase-request-detail` and `edit-address` are pushed
screens with back affordances, matching the web `activeView` model.

## 4. Phased plan

| Phase | Scope | Exit condition |
|---|---|---|
| **0. Foundation** ✅ **done** | shared logic package; theme token expansion; split `App.tsx` into screens; add the stack navigator | `npm run typecheck` and `npm test` pass; app behaves as before |
| **1. Shell** | header glyph cleanup, bell/avatar split, bottom nav, side nav, detail routing | side-by-side screenshots match |
| **2. Home** | welcome popup, category dropdown, sold-out sort + heading + badge, image placeholder, skeleton, category line, desktop rail; remove SKU line and Cart summary card | screenshot + copy diff clean |
| **3. Cart & Checkout** | deliver-to header, remove/remove-selected, deposit indicator, sticky total bar; empty-deposit line, date picker, confirmation dialog, primary/secondary address | place-order flow matches web end to end |
| **4. Orders & Purchase Requests** | tabs, filter dialog, pagination, order-detail page, PR detail page; remove mobile-only chips and date inputs | list + detail parity |
| **5. Replacements & POD** | replacement tab, replacement detail, POD display, request/cancel replacement, receive-return; new endpoints | full replacement lifecycle works from the app |
| **6. Track** | gradient strip, rescheduled badge, warehouse marker + guards, Delivery Journey, Delivery Details, driver card + call | live-delivery walkthrough matches |
| **7. Profile & Address** | avatar crop, 2FA / login alerts / remember device, empties tabs + deposit credit, structured Edit Address page, map pin + current location + service-area check | every profile subview matches |
| **8. Feedback & Receipt** | rating dialog with stars, feedback list copy, full receipt layout | copy diff clean |
| **9. Polish** | skeletons everywhere, toast layer, pull-to-refresh, accessibility labels, 44pt targets | audit checklist signed off |

Phases 1–8 are independently shippable; 0 must land first.

## 4a. Phase 0 outcome (completed 2026-08-30)

**Shared package** — `shared/customer-logic/` now holds `order-status.ts`,
`order-item-display.ts`, `mixed-case-deposit.ts`, `customer-types.ts` and the portable
half of `customer-common.ts`, moved with `git mv` so history follows. The web portal
keeps its original file paths as one-line re-export shims, so no existing web consumer
changed. Three helpers stayed web-side because they are DOM- or Tailwind-bound:
`createPdfBlob`, `getProductImage`, and `getReplacementBadgeClass` — the last is now a
thin lookup over a new shared `getReplacementStatusTone`, so the status-to-meaning
mapping is shared while the Tailwind strings stay on the web. Class output is unchanged.

**Deliberate app behavior change.** Mobile previously had its own status rules.
`normalizeOrderStatus`, `getOrderStageIndex`, `isOrderCancellable` and `isOrderTrackable`
now delegate to the web's. Checked against `backend/core/models.py`, the real
`OrderStatus` enum is `PENDING, CONFIRMED, PREPARING, RESCHEDULED, OUT_FOR_DELIVERY,
DELIVERED, REJECTED, CANCELLED`; the app's `SHIPPED` and `APPROVED` mappings were dead
code, and its cancellability rule was far looser than the web's (which also refuses once
an order is assigned to a trip). The unit test that asserted `SHIPPED → stage 2` was
replaced with coverage of every real enum value.

**Structure** — `App.tsx` went from 3368 to 331 lines:

| New file | Lines | Holds |
|---|---|---|
| `src/portal/portal-context.tsx` | ~1425 | all state, effects, handlers, memos + the navigation stack |
| `src/portal/portal-modals.tsx` | ~400 | every dialog above the shell |
| `src/screens/{auth,home,cart,checkout,purchase-requests,orders,track,feedback,profile}/` | 54–180 each | one screen per web view |
| `src/components/ui/*.tsx` | 14–61 each | the 10 presentational components |
| `src/styles/app-styles.ts` | 635 | the stylesheet, pending per-screen split |
| `src/lib/format.ts`, `src/lib/shared.ts` | 67, 34 | formatters; the shared-logic barrel |

State reaches screens through `useCustomerPortal()`, mirroring the web's
`useCustomerPortalState`. Screens were moved verbatim — no screen was rewritten, so Phase 0
carries no visual change.

**Navigation** — `PortalRoute` plus `pushRoute` / `popRoute` / `resetToTab` are in the
context. Nothing pushes a route yet; Phases 4 and 7 add the `order-detail`,
`purchase-request-detail` and `edit-address` screens that use them.

**Verified** — `npm run typecheck` and `npm test` (9 passing) clean in the app;
`npx next build` compiles the web portal, which exercises the `@shared/*` alias through
webpack. One pre-existing, unrelated error remains in
`src/components/portals/warehouse/WarehousePortal.tsx:2330` (it imports none of the moved
modules; the incremental build cache had been masking it).

**Deferred from Phase 0** — `portal-context.tsx` and `app-styles.ts` exceed the NFR-6
400-line guidance. Both shrink as Phases 1–8 move per-screen state and styles into the
screens; NFR-6 is met for every screen file today.

## 5. Functional requirements

- FR-1: Every screen, subview and dialog in the web customer portal MUST have an app counterpart
  with the same name, the same position in navigation, and the same entry points.
- FR-2: User-visible copy MUST match the web portal string-for-string, including empty states,
  helper text, validation messages and button labels.
- FR-3: Element order within a screen MUST match the web portal.
- FR-4: Colors, radii, spacing, type scale and icons MUST come from shared tokens derived from the
  web portal; no screen may hardcode a color.
- FR-5: The app MUST NOT present controls the web portal does not have (order status chips, order
  date-range inputs, purchase-request status chips, tracking-order chips, catalog SKU line,
  home Cart summary card).
- FR-6: Status normalization, delivery-stage index, order-status labels, item display labels, peso
  formatting and mixed-case deposit math MUST come from the shared module, not a mobile copy.
- FR-7: The app MUST support the full replacement lifecycle: request with per-product reason and
  evidence, view replacement details and items, view POD, cancel a replacement, and receive-return.
- FR-8: Purchase Orders MUST expose the `All / Delivered / To Review / Replacement` tabs, the filter
  dialog and 10-per-page pagination.
- FR-9: Purchase Requests MUST expose pagination and a dedicated detail screen.
- FR-10: Track MUST show the status strip, rescheduled badge, warehouse and destination markers,
  route, the two GPS guard messages, the described timeline with timestamps, the delivery-details
  card, and a driver card whose call button dials the driver.
- FR-11: Address editing MUST use the web's structured field set with map-pin selection, current
  location, Negros Occidental service-area validation, and address preview. Manual latitude and
  longitude entry MUST be removed.
- FR-12: Profile MUST expose 2FA, login-activity alerts and remember-device toggles, persisted the
  same way as the web portal.
- FR-13: Empties & Deposits MUST expose both tabs, per-case and per-bottle deposit values, the
  deposit-credit-to-apply control and the locked-deposit totals.
- FR-14: Checkout MUST show subtotal, new returnable-container deposit, existing empty deposits
  applied, discount with its 50-case note, and the total — and MUST use a native date picker.
- FR-15: Avatar changes MUST go through a crop step equivalent to the web crop dialog.
- FR-16: Loading MUST use skeletons equivalent to the web skeletons, not plain text.
- FR-17: The app MUST reuse existing API endpoints and MUST NOT introduce a parallel data store.
- FR-18: The web customer portal MUST NOT change, except where a verified API-contract defect makes
  a minimal compatibility fix necessary.

## 6. Non-functional requirements

- NFR-1: `npm run typecheck` and `npm test` in `mobile/customer-app` MUST pass on every phase.
- NFR-2: Interactive targets MUST be at least 44×44 pt and carry accessibility labels.
- NFR-3: Copy MUST remain readable at the platform's enlarged text settings without hiding the
  primary action.
- NFR-4: Authenticated calls MUST send the bearer token and MUST treat 401 as an expired session.
- NFR-5: No production secret or map access token may be embedded in the bundle.
- NFR-6: No screen file may exceed ~400 lines after the split.

## 7. Acceptance criteria

- **AC-1 (FR-2, FR-3):** For each of the 12 screens, a side-by-side capture of web (mobile
  viewport) and app shows the same elements in the same order with the same copy.
- **AC-2 (FR-5):** Grepping the app for the removed controls returns no results.
- **AC-3 (FR-6):** `src/lib/customer-logic.ts` no longer redefines status or formatting helpers;
  they resolve to the shared module.
- **AC-4 (FR-7):** A delivered order can be taken through request → view → cancel → receive-return
  in the app, and the same records appear in the web portal.
- **AC-5 (FR-8, FR-9):** With 25 orders, all four tabs paginate at 10 per page with the same range
  label as the web portal.
- **AC-6 (FR-10):** With a driver actively delivering, the app shows the live marker, route,
  warehouse, timeline timestamps and a working call button; with the order not out for delivery it
  shows the web's guard message instead of a map.
- **AC-7 (FR-11):** Saving an address pinned outside Negros Occidental is rejected with the web's
  message; no latitude/longitude input is present.
- **AC-8 (FR-12, FR-13):** Toggling 2FA in the app is reflected in the web portal after reload, and
  both empties tabs render with matching figures.
- **AC-9 (FR-14):** A checkout with returnable containers and a 50-case discount shows identical
  line items and total to the same cart on the web.
- **AC-10 (FR-16):** Every list and detail screen renders a skeleton, never bare text, while loading.

## 8. Risks

- **Drift returns.** The shared logic package (§3.1) covers computation but not copy or layout.
  Mitigation: a string-parity test that asserts the app's user-visible strings are a subset of the
  web portal's.
- **Layout primitives.** CSS grid layouts (product grid, track cards) need flexbox equivalents;
  budget time in phases 2 and 6.
- **Map parity.** Web uses `DriverRouteMap` (MapLibre GL JS); app uses
  `@maplibre/maplibre-react-native`. Marker and route styling must be re-authored, not ported.
- **Scope.** This is ~12 screens with dialogs. Phases exist so review happens incrementally rather
  than as one unreviewable diff.
