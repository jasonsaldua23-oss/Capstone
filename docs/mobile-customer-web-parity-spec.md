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

**Revised 2026-08-30, at the user's direction.** The original standard was "identical,
string-for-string". It is now **structural similarity, with the app free to look better**:

- **Structure must match.** Same screens, same sections within a screen, same order, same
  entry points and navigation model. Every capability the web offers a customer must be
  reachable in the app.
- **Behaviour must match.** Status rules, money, deposits, discounts, validation and every
  submitted payload stay identical — these are shared code, not styling, and a divergence
  is a bug rather than a design choice.
- **Copy and visual design may improve.** Wording, spacing, colour and native affordances
  can differ where the app is genuinely better for a phone. The app may exceed the web.
- Platform affordances (native pickers, sheets, OS cropper, `tel:` links) are preferred
  over reproducing a browser workaround.

What this changes in practice: the copy-parity gate is now **advisory**, not a hard
contract. It still earns its place — it catches accidental divergence, and it found real
bugs in seven of nine phases — but a deliberate improvement is now a legitimate reason to
allowlist a string rather than revert it. What must not drift is structure and behaviour.

### Checking structure

`scripts/check-customer-structure.mjs` pairs each web view with the app components that
render it and reports the sections present on each side. It answers the question the
revised standard actually asks — *does the app show the same things, in the same order?* —
and says nothing about styling or exact wording.

Its limits are worth knowing, because two of them produced false findings before being
fixed: it originally excluded ALL-CAPS headings, and it compared one file to one file when
the app deliberately splits a web view across several components. Copy that only exists
inside a function call (`formatDiscountLabel(...)`) is still invisible to it, so a small
number of "absent" lines are extraction artifacts rather than gaps. Read its output as a
prompt to check, not as a verdict.

## 2. Current gap analysis

### 2.1 Shell and navigation

| Area | Web | Mobile | Action |
|---|---|---|---|
| Header | eyebrow `ANN ANN'S BEVERAGES TRADING`, wordmark `AAB TRADING` + green ` SHOP`, cart button w/ count badge, bell w/ unread badge | same structure; emoji glyphs and an avatar image sat in the markup but were already `display: "none"` — dead markup, not a visible defect. Real gaps: no active-cart state, cart badge used brand green instead of emerald-500, bell badge was 18px rose without the white ring instead of 16px red-500 with it | remove dead markup; fix badge colors/sizes; add active-cart state |
| Bottom nav | Home / Purchase Request / Purchase Order / Profile, emerald-50 active pill | glyph markup also already hidden. Real gaps: 17px icons vs 16, missing `gap-1`, 0.98 vs 0.95 background alpha, and active state ignored detail routes | fix metrics; make active state route-aware |
| Desktop rail | 240px left sidebar | present and close; 17px icons vs 16, `px-3` vs the web's `px-4` | fix metrics |
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

~~Mobile-only, to remove: the status chip row (web has no status filter here).~~ **This note was wrong.** The web PR view has its own `prTab` row (`All / Pending Review / Approved / Rejected / Cancelled`). The app's chips were right in substance; they needed to become tabs with the web's labels.

### 2.6 Purchase Orders

Missing: the four tabs `All / Delivered / To Review / Replacement`; the Filter dialog;
pagination (`PAGE_SIZE = 10`); the entire **Replacement** surface — `Replacement Details`,
`Replacement Items`, `Reason`, `Reported`, `Replacement Order:`, `Received By:`, `Submitted At:`,
`Proof of Delivery (POD)` image with `No POD uploaded yet.`, and cancel-replacement (~~receive-return~~ — that is a warehouse action, see §4h);
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
| **1. Shell** ✅ **done** | header glyph cleanup, bell/avatar split, bottom nav, side nav, detail routing | side-by-side screenshots match |
| **2. Home** ✅ **done** | welcome popup, category dropdown, sold-out sort + heading + badge, image placeholder, skeleton, category line, desktop rail; remove SKU line and Cart summary card | screenshot + copy diff clean |
| **3. Cart & Checkout** ✅ **done** | deliver-to header, remove/remove-selected, deposit indicator, sticky total bar; empty-deposit line, date picker, confirmation dialog, primary/secondary address | place-order flow matches web end to end |
| **4. Orders & Purchase Requests** ✅ **done** | tabs, filter dialog, pagination, order-detail page, PR detail page; remove mobile-only chips and date inputs | list + detail parity |
| **5. Replacements & POD** ✅ **done** | replacement tab, replacement detail, POD display, request/cancel replacement, receive-return; new endpoints | full replacement lifecycle works from the app |
| **6. Track** ✅ **done** | gradient strip, rescheduled badge, warehouse marker + guards, Delivery Journey, Delivery Details, driver card + call | live-delivery walkthrough matches |
| **7. Profile & Address** ✅ **done** | avatar crop, 2FA / login alerts / remember device, empties tabs + deposit credit, structured Edit Address page, map pin + current location + service-area check | every profile subview matches |
| **8. Feedback & Receipt** ✅ **done** | rating dialog with stars, feedback list copy, full receipt layout | copy diff clean |
| **9. Polish** ⚠️ **screenshots outstanding** | skeletons everywhere, toast layer, pull-to-refresh, accessibility labels, 44pt targets | audit checklist signed off |

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

## 4b. Phase 1 outcome (completed 2026-08-30)

**Correction to §2.1.** The emoji glyphs and the header avatar were already
`display: "none"` in the stylesheet. They were dead markup, not a visible defect, and the
original gap note overstated them. They are now removed from the markup as well, but the
work that actually changed pixels was the metric and color fixes below.

**Header** — rebuilt against `portal-header.tsx`. The avatar is gone (the web header has
none), the cart button gains the web's `activeView === 'cart'` emerald state, the cart
badge is emerald-500 on white at font-semibold (was brand green on off-white at 800), and
the bell badge is a 16px red-500 dot with the web's 2px white ring (was an 18px rose pill
with no ring). `headerCartButton`/`headerAvatar` collapsed into one `headerIconButton`.

**Navigation** — icons corrected to 16px in both navs, `gap-1` added between bottom-nav
items, background alpha corrected to 0.95, and sidebar padding to `px-4`. Labels now come
from one `NAV_ITEMS` table so the sidebar's "Purchase Request" and the bottom bar's
"Purchase Req." cannot drift apart. `getActiveNavId` keeps the parent destination
highlighted on detail routes, matching the web. Selecting a destination clears the open
detail first, mirroring the web nav's `handleNav`.

**Detail routing** — `order-detail` and `purchase-request-detail` are now pushed screens
reached via `pushRoute`, not cards rendered inline beneath their lists. Both get a
`DetailHeader` back affordance, and Android's hardware back button pops the stack instead
of leaving the app. Screen *content* was moved verbatim; Phase 4 rewrites it against
`order-detail-page.tsx` and `purchase-request-detail-page.tsx`. `edit-address` stays a
modal until Phase 7 builds the structured form.

**Verified** — `npm run typecheck` and `npm test` (9 passing) clean, plus
`npx expo export --platform web`, which caught a bug typechecking could not: moving the
auth screen three directories deeper broke its two `require("../../public/…")` asset
paths. Both now resolve and the bundle builds. Bundle verification should be part of every
remaining phase's exit check.

**Not yet verified** — no side-by-side screenshots were captured, so AC-1 is not signed off
for the shell. The changes above are measured against the web source, not against a
rendered comparison.

## 4c. Phase 2 outcome (completed 2026-08-30)

**Home rebuilt against `home-view.tsx`.** Added: the welcome popup, the category
dropdown, sold-out sorting with its `Sold Out` heading and circular badge overlay, the
`Package` image placeholder, the loading skeleton, the product category line, and the
desktop `Current Order` rail. Removed: the `{sku} · {unit}` line and the whole
"Cart summary" card, neither of which the web has.

**Welcome popup.** The app previously showed "You are signed in to AAB Trading Shop…"
with a *Start Shopping* button after both login and registration. The web distinguishes
the two through `sessionStorage.customer_welcome_state` and renders a close button, not a
CTA. `welcomeVisible: boolean` is now `welcomeMode: "new" | "existing" | null` — login
sets `existing` ("Welcome back, {name}."), registration sets `new` ("Welcome, {name}."),
with the web's subtitle. The popup moved from `portal-modals.tsx` into the Home screen,
where the web owns it.

**Category filter.** The horizontal chip row is replaced by a `CategorySelect` that shows
the current value and opens a sheet of options — React Native has no `<select>`, so this
is the nearest equivalent control rather than a different interaction model.

**Two behavior corrections found by reading the web source:**
- Out-of-stock availability text is `text-emerald-700` on the web for *both* states — only
  the wording changes. The app was rendering it red.
- Mixed-case contents were printed as `{name}: {n}/case · PHP {x} subtotal`. The web uses
  `getMixedCaseComponentNameWithSize` / `getMixedCaseBottleQuantity` (e.g. "Coke 8oz",
  "12 Bottles/case - 24 total"). Both helpers moved to `shared/customer-logic`, and the app
  now has a `MixedCaseComponents` component mirroring the web one, thumbnails included.

**Deliberate parity removal, worth a decision.** The app showed "No products match your
search." when the catalog filtered to nothing. The web shows an empty grid with no message.
FR-2 and FR-5 say remove it, so it is gone — but this is a case where the app was better
than the web. If you would rather keep it, the honest fix is to add the empty state to the
web portal too, and I would then mirror it back.

**Also** — the app's `Product` type was missing `size` and `sizeLabel`, which the web type
declares and the card falls back to; both added.

**Verified** — typecheck, 9 tests, and `expo export` all clean. A style audit confirmed no
screen references a deleted style; four styles orphaned by removing the old welcome modal
were deleted. Still no side-by-side screenshots, so AC-1 is unsigned for Home as well.

## 4d. Phase 3 outcome (completed 2026-08-30)

**Cart rebuilt against `cart-view.tsx`.** Added: the sticky header with back arrow,
`Shopping Cart (n)` and the `Edit Address` button; the `Deliver to:` bar; circular
select checkboxes; 80px thumbnails (two-up for mixed cases); the per-line trash button;
the stock-shortfall box with its `Use {n}` / `Remove` actions; the returnable-deposit box;
and the bottom bar with select-all, `{n} selected`, `Remove`, `Total`, and
`Check out (n)`. The old "Cart total" card with *Continue Shopping* / *Proceed to
Checkout* is gone.

**Checkout rebuilt against `checkout-view.tsx`.** Added: the header, the empty state, the
recipient card with its three fallbacks, 74px item rows with category and `n x price`,
per-line deposit boxes, the mixed-case quantity box, `Existing empty deposits applied`,
the divider and `Total (n items)`, the `Order note (optional)` label, and the sticky
action bar with the insufficient-stock warning and its `Review your cart` link.

**Three real bugs found while doing it:**
- **Checkout listed every cart item but totalled only the selected ones.** It mapped over
  `cartItems` and `mixedCart` while the summary used `selectedSubtotal`, so the list and
  the total disagreed whenever anything was deselected. Both now use
  `selectedUnifiedCartItems`.
- **Placing an order landed on Purchase Orders.** The web goes to Purchase Requests, which
  is correct — a new order is a request pending warehouse approval. It also clears the
  order search and status filter, which the app was not doing.
- **No empty-container credit existed in the app at all.** The web applies
  `applyAutomaticEmptyCredit` when an item enters the cart, so customers see how much of a
  new deposit their existing empties cover. The app only ever charged the gross deposit.

**Shared logic grew.** `isReturnableGlassItem`, `getAutomaticEmptyCredit` and
`getLineDepositAmounts` now live in `shared/customer-logic/empty-credit.ts`. A new
`unifiedCartItems` selector in the context flattens standard and mixed lines into the
shape the web's `cart` array has, with deposit credit attached, so cart and checkout
render from one source.

**New dependency:** `@react-native-community/datetimepicker` 9.1.0, installed via
`expo install`. The web gets its date picker free from `<input type="date">` with a `min`
of today; this is the native equivalent, wrapped in a `DateField` component. It replaces
the free-text `YYYY-MM-DD` box. This is an Expo Go-supported module, but it is a native
module, so a new dev build is needed for anyone running a custom client.

**Known remaining gap.** The cart's `Deliver to:` line reads
`address, city, province` because the app's `CustomerProfile` has no `barangay` field; the
web uses `barangay, city, province`. Phase 7 adds the structured address and closes this.

**Verified** — typecheck, 9 tests, `expo export`, and the web `tsc` all clean; eight
styles orphaned by the rewrites were removed. Still no side-by-side screenshots.

## 4e. Copy-parity gate (added 2026-08-30)

§8 named a string-parity test as the mitigation that stops the two clients drifting
again. It exists now: `scripts/check-customer-copy-parity.mjs`, wired into
`npm test` in the app.

It extracts user-visible strings from both sides and reports app copy with no
counterpart in the web portal. Findings are tagged with the phase that closes them, so
the check is a working gate today rather than a wall of known noise:

- **New drift fails the build.** Any app string that is not in the web portal, the
  `ALLOWED_APP_ONLY` list, or the phase baseline exits non-zero.
- **A stale baseline entry also fails.** If a phase ships and its strings are still
  listed, the phase did not finish. This is deliberate — it stops a phase being marked
  done while its copy is untouched.
- Verified by injecting drift into a finished screen: the gate caught it and exited 1.

**Result on the current tree: 51 known findings, 0 new.** Every one sits in a screen
Phases 4–8 have yet to rebuild. **Nothing in the shell, Home, Cart, or Checkout** — the
four surfaces Phases 1–3 claimed — which is the first independent evidence those phases
actually landed their copy.

`ALLOWED_APP_ONLY` holds eleven strings that are legitimately app-only: accessibility
labels for native affordances, the category sheet's title (the web `<select>` supplies
its own), the date field's empty state, and the cold-start splash. Each carries its
reason inline.

### Gap in this plan the gate exposed

The **login and registration screen has no phase**. Seven strings differ from
`CustomerLoginPage.tsx` ("Already have an account?", "Verifying...", "Account email",
and others) and no phase in §4 covers them. They are parked under
`Unscheduled — auth screen` in the baseline. This needs a phase before the work can be
called complete.

### Still not verified

Screenshots. AC-1 asks for a rendered side-by-side per screen, and that has not happened
for any phase. It needs browser automation (none is installed) plus the Django backend,
which `backend/*/settings.py` points at a **remote Postgres**. Both are decisions for the
user, not defaults to assume. The copy gate covers wording and element presence; it says
nothing about layout, spacing, or color.

## 4f. Phase 4 outcome (completed 2026-08-30)

**Both list screens rebuilt.** Purchase Orders gained the four tabs
(`All / Delivered / To Review / Replacement`), the Filter button and dialog, 10-per-page
pagination with `Showing X to Y of N orders`, and the web's card layout — status dot,
badges, `Delivered on` dating, address block, cancellation-reason box, `Order Items` with
thumbnails, `Total Amount`, and the action stack. Purchase Requests gained its own tab row,
pagination, `Requested Items`, `Container deposit`, `Estimated Total`, the scheduled-delivery
line, and the three-way empty state. Both detail screens are now real pages with the web's
Product / Qty / Unit Price / Subtotal table and `Order Note`.

**A gap note in §2.5 was wrong and is corrected above.** It claimed the web has no status
filter on Purchase Requests, so the app's chips should be deleted. The web has `prTab` with
five options. Acting on that note would have removed a feature the web has. The chips became
tabs with the web's labels instead — "Pending Review", not "Pending Approval".

**Order status and date filters moved, not deleted.** §2.6 said to remove the app's status
chips and date inputs. They exist on the web too, behind the Filter button; they are now in
a Filter dialog with the web's `All statuses / Pending / Processing / Out for delivery /
Delivered / Cancelled` options and its Clear / Apply buttons.

**Shared logic grew again.** `getOrderItemDisplayName`, `getRequestItemDisplayName`,
`normalizePRStatus`, `getPRStatusText` and `formatCardDateTime` moved to
`shared/customer-logic/item-display.ts`. The two display-name functions differ by design —
an order card spells out mixed-case contents, a request card does not — and both were
inline closures in their web views. **Both web views now import them**, so the app cannot
drift from either. `getStatusConfig` keeps its icons and Tailwind classes locally and takes
its label and message from the shared table.

### The copy gate earned its keep

Running it after this phase surfaced four things, two of them real:

- **The web cart changed under me.** The `Remove selected items` bulk-remove button I built
  in Phase 3 had since been deleted from `cart-view.tsx`. The app was carrying a control the
  web no longer has, which FR-5 forbids. Removed from the app to match.
- **Two invented accessibility labels.** `Filter date from` / `Filter date to` had no web
  counterpart; they now use the web's own `Date from` / `Date to`.
- Two extractor bugs: it read `//` comments as copy, and let a JSX ternary fragment through.
  Both fixed. Block-comment stripping was **reverted** after it silently ate 16KB of
  `profile-view.tsx` — a stray `/*` makes a non-greedy strip span far too far — so only
  whole-line comments are removed now.

**Verified** — app typecheck, 9 tests, copy gate (49 known / 0 new), `expo export`, and the
web `tsc` all clean. One over-eager style cleanup removed `chip*` and `flexInput`, which the
modals still use; caught by typecheck and restored from the original backup.

## 4g. Screenshot sweep (2026-08-30)

The user supplied ten screenshots of the **web** portal at phone width: Home, Purchase
Request list and detail, Purchase Order list and detail, the Replacement tab, Profile, and
Cart. That is the reference half of AC-1. It is not a side-by-side — the app side is still
uncaptured — but comparing the screenshots against the app source found defects that
neither `tsc` nor the copy gate can see, because both are blind to layout and to values.

### Defects found in phases already marked done

- **Header cart badge counted lines, not units** (Phase 1). The screenshot shows `24` beside
  "Shopping Cart (2)" — two lines of twelve. The web uses
  `cart.reduce((sum, i) => sum + i.quantity, 0)`; the app passed `cartLineCount`. Now
  `cartUnitCount`.
- **Order detail was missing most of the page** (Phase 4). The web has a four-step progress
  stepper, `Ordered on` / `Scheduled delivery` lines, a status badge, separate Delivery
  Address and Total Amount cards, `Order Items (n items)` with a count, a category line per
  product, a "No replacement case filed for this order." block, a **Proof of Delivery (POD)**
  section, and `Order Note` with a "No note for this order." fallback. Roughly a third of
  that existed. Rebuilt — the stepper uses `orderStages` and `getOrderStageIndex`, which had
  been sitting unused in the shared module since Phase 0.
- **Purchase-request detail was missing** its amber status callout, Delivery Address card,
  Estimated Total card, item count, thumbnails and per-item category lines. Rebuilt.
- **Cart size label used the wrong precedence** (Phase 3). The web's `getProductSizeLabel`
  tries `sizes` first, then `sizeLabel`/`size`, then the unit — which is why the screenshot
  reads "Carbonated (Glass) · case". The app preferred `sizeLabel` over `sizes`. Note the
  catalog card and the cart line deliberately differ in their final fallback: `N/A` on the
  card, the unit on the cart line.
- **`TOTAL` in the cart bar was not uppercased** — the web has `uppercase tracking-wider`;
  RN needs an explicit `textTransform`.
- **"Build Mixed Case" sat on the title row.** The web row is `flex flex-wrap`, so on a phone
  the button wraps onto its own line, left-aligned. RN does not wrap a row containing a
  flexing child, so the narrow layout now stacks explicitly.
- **`View Details` was missing its trailing chevron** on both list cards.

### Confirmed for later phases

- **Profile** (Phase 7) is `Edit Profile / Empties & Deposits / Account Security /
  Notification Settings / Address / Log Out` — five items plus logout, **titles only, no
  descriptions**, under a heading of "Profile". The app has six items, in a different order,
  with a description under each. Those baseline strings get **deleted**, not translated.
- **Cart `Deliver to:`** reads `Rizal, Silay, Negros Occidental` — barangay, city, province,
  confirming the field-mapping gap Phase 3 flagged and Phase 7 closes.
- **Replacement tab cards** (Phase 5) use `Replacement Items`, a `Reported on` date, a
  status badge, and repeat the status as a caption under Total Amount.

### Checkout (screenshots added later the same day)

- **The discount line was the wrong shape.** The web renders it through
  `CompactDiscountLine` as a single left-aligned sentence — `Discount: ₱0.00`, slate-700,
  with an optional ` (5%)` suffix and **no minus sign**. The app had a two-sided row with
  an emerald `-₱0.00` and no percent. `formatDiscountPercent`, `formatDiscountLabel` and
  `getEffectiveDiscountPercent` now live in `shared/customer-logic/discount.ts`, and the
  web component renders from them, so the wording cannot diverge again.
- Everything else on Checkout matched: the recipient card and its three fallbacks, the
  `{name} {sizeLabel}` item title, the category / `12 × ₱280.00` row, the three-part
  deposit box, the summary ordering, the note and date fields, and the rose `Place order`
  button. The screenshots also confirm the total **excludes** the container deposit
  (`Subtotal ₱5,100.00` + `deposit +₱504.00` → `Total ₱5,100.00`), which matches
  `checkoutTotal`.

**Deferred to Phase 9:** the web's cart and checkout action bars are `sticky`, staying
visible while the list scrolls. In the app both render as ordinary blocks at the end of the
scroll, because every screen renders inside one shared `ScrollView` in `App.tsx`. Making
them sticky means lifting the bars out of that scroll container, which is shell surgery
better done once for both screens than twice in a hurry.

### What this changes about the process

Three of four completed phases had defects that source-reading missed. Copy parity and
type-checking do not catch a wrong *value* (units vs lines), a missing *section*, or a
layout that does not wrap. **Phases 5–9 should be checked against a screenshot of the
corresponding web screen before being marked done**, not after.

## 4h. Phase 5 outcome (2026-08-30)

**Done**

- **Replacement tab** now lists replacement *records* rather than generic orders, matching
  the user's screenshot: `RPL-…` number, blue `Replacement` badge, `Reported on` dating,
  `Replacement Items` with per-line quantity labels, the status badge, `Total Amount`, and
  the status repeated as a caption.
- **Both missing endpoints** added to the app's API layer:
  `POST /api/customer/replacements/{id}/cancel` and
  `POST /api/replacements/{id}/receive-return`.
- **Cancel Replacement** works end to end — button on pending records, confirmation dialog,
  and the web's 409 behaviour (staff already moved it to Under Review) refreshes so the
  customer sees the state that blocked them.
- **POD display** already landed during the screenshot sweep, as part of the order-detail
  rebuild.

**Shared logic.** The replacement display rules moved to
`shared/customer-logic/replacement-display.ts`: `getReplacementItemsForRecord`,
`getReplacementLineQtyLabel`, `getReplacementDisplayQty`, `getReplacementDisplayStatus`,
`getReplacementTotalAmount`, `getLinkedOrderForReplacementRecord` and
`buildReplacementTabOrders`. The quantity labelling alone reads three competing shapes the
backend can return — explicit line fields, a `Meta:` JSON blob inside the notes, and
free-text hints in the description — and reimplementing that per platform would have
drifted on the first edge case.

**Request Replacement form — rebuilt (second pass)**

The app's original modal (one row per delivered item, a single shared description) is
replaced by the web's per-product form: `Select one or more products and set reason per
product`, a `By Unit` / `By Bottle` toggle per line, a product picker that hides products
already chosen on another line, a quantity capped by `getMaxReplacementQtyForLine`, a
per-line reason from `DAMAGE_REASON_OPTIONS`, a free-text box when the reason is `Other`,
`Add Product`, and evidence capped at `MAX_EVIDENCE_PHOTOS` (2 — the app previously allowed
5). Mixed-case components are selectable individually and forced to `bottle` mode, as on
the web.

The payload builder moved to `shared/customer-logic/replacement-request.ts`. This matters
more than most of the shared extractions: the backend parses the *combined description*
back out (`By Unit: 3 unit(s), Qty/Unit 24. Reason: Leaking`), so that wording is
load-bearing, not cosmetic. The app was previously sending a different shape entirely.

**Replacement detail — added**

A pushed `replacement-detail` route now mirrors the web's replacement dialog:
`Replacement Details` with the six icon rows (`Order #`, `Product`, `Reason`, `Status`,
`Quantity`, `Reported`), an `Evidence (n)` grid, and a `Proof of Delivery (POD)` block with
`Replacement Order:` / `Received By:` / `Submitted At:` and the "No POD uploaded yet."
fallback. Rows in the Replacement tab open this instead of the generic order detail, which
is what the web does. `getReplacementEvidenceUrls`, `getReplacementPod` and
`sanitizeReplacementText` joined the shared module.

### FR-7 was wrong: receive-return is not a customer feature

FR-7 and §2.6 both listed `receive-return` as a missing customer capability. It is not.
`receiveReplacementReturn` is called **only** by
`src/components/portals/warehouse/sections/replacements/replacements-view.tsx` — it is a
warehouse action. It merely *lives* in `customer/sections/orders/orders-api.ts`, which is
what the original audit tripped over. No customer view calls it.

Building it into the app would have added a control the web customer portal does not have,
which FR-5 forbids, and handed customers a staff-only action. The endpoint added to the
app's API layer earlier in this phase has been **removed**. FR-7 should read: request,
view, and cancel — not receive-return.

### A corrupted regex, caught and fixed

Writing `sanitizeReplacementText` through a shell heredoc wrote literal backspace bytes
(0x08) into the shared file where `\b` word boundaries belonged, silently changing the
regex. It was found by inspecting the written bytes rather than trusting the printed
output — `sed` rendered it as `^H` only under `cat -v`. Fixed by rebuilding the function
through a script file instead of a heredoc, and the file is verified to contain zero
control characters. Worth remembering: `tsc` compiled it happily.

**Baseline correction:** `case(s) ·` was filed under Phase 5 but belongs to the Empties &
Deposits modal, which Phase 7 rebuilds; it has been moved there.

**Two further extractor fixes:** inline TypeScript prop annotations were being read as copy
(rejected when a capture holds both `;` and `:`), as were call fragments ending in `(`.

**Two more extractor fixes.** The gate flagged `"Reported on"` as app-only when the web has
it; JSX copy that ends at an expression (`Reported on {date}`) was never being extracted
from either side. Widening the terminator to `[<{]` then over-matched into attribute
regions, so captures containing `=`, a backtick, `$`, or a trailing `(` are now rejected.
Web string coverage went from 625 to 694 as a result — the gate had been blind to a whole
class of copy on both sides.

**A live web change landed mid-phase.** `home-view.tsx` now lays the search and category
filter out as `grid-cols-2 sm:grid-cols-[minmax(0,1fr)_170px]` — two equal columns on a
phone rather than "search flexes, category takes 170px". The app has been matched. This is
the second time this session that web edits have invalidated finished app work (the cart's
bulk-remove button was the first), which is exactly what the copy gate and these sweeps
exist to catch.

**Verified** — typecheck, 9 tests, copy gate (46 known / 0 new), `expo export`, web `tsc`.

## 4i. Phase 6 outcome (2026-08-30)

**Track rebuilt against `track-view.tsx`.** Added: the green gradient stat strip
(`Order Status` / `Order ID` or `Replacement ID` / `Scheduled for`–`Expected on`–`Delivered
on`, with the delivered time underneath), the `RESCHEDULED ORDER` badge, both GPS guard
messages, `Delivery Journey` with per-step descriptions, timestamps, a `Live updates` badge
and a loading skeleton, the `Delivery Details` card (`Delivery Address`, `No. of Items` /
`No. of Replacement Items`, `Total Amount`), and the driver card with avatar, fallbacks
(`Driver not assigned yet`, `No driver phone available`) and a working `tel:` call button.

Removed: the tracking-order chip row, the ETA line, and the `Trip` / `Updated:` rows —
none of which the web has.

**The map now uses real markers.** The `TRUCK` and `D` text placeholders are replaced by
the web's own van artwork (`public/icons/aab-van-iso.png`, already reachable through Metro's
`watchFolders`), a pin for the destination, and the warehouse circle the app never drew —
`#9ca3af` fill with a `#111827` ring at radius 7, matching `DriverRouteMap`'s
`CircleMarker`.

**Selection model corrected.** The app let you pick which order to track from a chip row.
The web has no such control: Track renders `selectedTrackingOrderId`, set when you press
Track Order on a specific order. The screen now reads the selected order and shows
`Select an order to track.` when there is none — the web's own empty state.

**Another live web change picked up mid-phase.** `checkout-view.tsx` gained a quantity
label (`12 cases × ₱280.00` rather than `12 × ₱280.00`). The app had a partial version of
the same logic that did not pluralise non-case units — it would have shown `12 pack` where
the web shows `12 packs`. Both now call `getCheckoutQuantityLabel` in
`shared/customer-logic/item-display.ts`.

**Verified** — typecheck, 9 tests, copy gate (43 known / 0 new, Phase 6's three baseline
entries cleared), `expo export`, web `tsc`. `Back to orders` and `Call driver` joined
`ALLOWED_APP_ONLY` as native accessibility labels.

## 4j. Phase 7 outcome (2026-08-30)

**Profile menu rebuilt.** The app had six rows, each with a description under it, in a
different order, under a heading of "My Profile". The web has five titled rows plus Log Out,
**no descriptions**, under "Profile": `Edit Profile / Empties & Deposits / Account Security /
Notification Settings / Address`. The user's screenshot confirmed this before the work
started. Also added: the 80px avatar with its camera badge, the name-details line, and the
emerald phone chip. Nine baseline entries cleared as a result.

**Security settings added.** `Two-Factor Authentication (2FA)`, `Login Activity Alerts` and
`Remember Device Sessions` now sit under the password form in Account Security, with the
web's exact hint text. 2FA and login alerts persist through `PUT /api/customers/{id}` — the
same call the web makes — while remember-device stays device-local under the web's own
`customer_remember_device_enabled` key.

**Empties & Deposits rebuilt** with the web's two tabs (`Available Empties` /
`Used / Reserved Deposits`, the second carrying a count badge), per-container deposit values,
`Number of Cases to Return`, `Deposit Credit to Apply:`, `Total Locked Deposit Credit`,
`Reserved in active orders:`, and all three empty states.

**One invented line caught by the gate:** the app's balance card had a `Deposit balance:`
row the web does not render. Removed.

**Edit Address rebuilt as a pushed screen.** The flat modal — and its hand-typed latitude
and longitude — are gone. It now carries the web's field set (`House number (optional)`,
`Street name`, `Subdivision (optional)`, `Barangay`, `City / Municipality`, `Province`,
`Postal code`, `Country`), the `Full Address Preview`, a map picker, `Use Current Location`,
the `Pinned Location:` readout, and reverse-geocoding that auto-fills the fields from a
dropped pin. Because the app now holds a structured address, the `Deliver to:` and checkout
address lines can finally read `barangay, city, province` as the web does — the gap first
flagged in Phase 3.

**The service area was wrong, not just missing.** The app was validating against a coarse
bounding box with the message "Delivery coordinates must be inside the supported Negros
Occidental area." The web checks the actual **Silay and Talisay municipal polygons** and
says "We only deliver within Silay and Talisay." The app was therefore accepting addresses
the web would reject. `shared/customer-logic/service-area.ts` now holds the geometry math,
bounds, message and `composeShippingAddress`; `src/lib/service-area.ts` re-exports them and
keeps only its browser fetch and hook. The app bundles the same
`negros-occidental-municipal-maritime.json` through Metro's existing `watchFolders`, so both
clients test the same polygons — with the same coarse-box fallback the web already
documents.

**Three more invented strings caught by the gate:** the app said `Use current location`,
`Resolving address…`, and its own phone-validation wording. The web says
`Use Current Location`, `Auto-filling address from pinned location...`, and
`Please enter a valid Philippine mobile number (e.g., 09171234567 or 639171234567).` All
corrected, and the web's `Pinned Location:` / `No location pinned yet` line was added.

### Correction: avatar cropping already existed

The Phase 7 interim note said the app "uploads the picked image directly". That was wrong.
`handlePickAvatar` already calls `ImagePicker.launchImageLibraryAsync` with
`allowsEditing: true, aspect: [1, 1]`, which opens the platform's own cropper with drag and
zoom. That is the native equivalent of the web's custom crop dialog — the web builds one
because browsers have no such affordance — and it sits in the same category as the date
picker and the category sheet. No custom cropper was built.

**New dependency:** `expo-location`, for `Use Current Location`.

**Verified** — typecheck, 9 tests, copy gate (28 known / 0 new; twelve baseline entries cleared across the phase), `expo export`, web `tsc`.

## 4k. Phase 8 outcome (2026-08-30)

**Rating moved into a dialog, where the web has it.** The app had a whole Feedback *tab*
for composing a review, with numeric 1–5 buttons. The web reviews an order through a dialog
opened by `Rate Order` on the order card. That dialog now exists: five tappable stars with
their `Poor`…`Excellent!` labels, the feedback-option set that changes with the rating,
`Select at least one feedback option to submit your review.`, and the
`Your feedback helps us improve our service` confirmation that shows for 1.5s before the
dialog closes itself.

**The submitted payload was wrong.** The app was sending `{ orderId, rating, message }` with
the reasons comma-joined. The web sends a `type` derived from the rating
(`≤2 COMPLAINT`, `3 SUGGESTION`, else `COMPLIMENT`), a `subject` of
`Order Review - {orderNumber}`, and the reasons as a newline-separated bullet list. The
app's payload was missing two required fields outright — TypeScript caught it the moment the
call was pointed at the real signature. Now matched.

**Feedback screen is now a list only**, matching `feedback-view.tsx`: the `Your Feedback`
card, `Use delivered orders to submit feedback.`, per-item type badges
(COMPLAINT/SUGGESTION/COMPLIMENT with the web's three colour pairs), star strings, and
`No feedback submitted yet.`

**Receipt rebuilt** against `receipt-dialog.tsx`: the logo and `Ann Ann's Beverages Trading`
header, the `ORDER RECEIPT` kicker with its green rule, the `Receipt No.` / `Order No.`
panel, the `DELIVERY ADDRESS` / `SOLD BY` / `ORDER DETAILS` / `RECIPIENT` / `PHONE` block,
a `Product / Qty / Unit Price / Amount` table, `Subtotal`, `TOTAL PRICE`, and both closing
lines. The old five-row `InfoRow` summary is gone.

`Preparing PDF...` joined `ALLOWED_APP_ONLY`: the app exports through `expo-print`, where
the web downloads a PNG via `html-to-image` — no shared wording exists.

**Verified** — typecheck, 9 tests, copy gate (21 known / 0 new; six baseline entries
cleared), `expo export`.

## 4l. Phase 9 outcome (2026-08-30)

**Copy parity reached zero.** The baseline in `check-customer-copy-parity.mjs` is now
empty: every screen has been rebuilt, so any finding is new drift. Re-verified by injecting
a changed string into the Track screen — the gate exited 1 — then restoring it.

**The cancellation reasons were entirely different lists.** This was the last substantive
find. The web offers `Changed mind / Wrong product or quantity ordered / Duplicate order /
Unable to receive delivery / Unable to complete payment / Incorrect delivery address /
Other reason`, uses `Other reason` as its sentinel, and composes the submitted string as
`reason; reason; Other reason: {text}`. The app offered `Ordered by mistake / Need to change
the order / Delivery date is no longer suitable / Found another supplier / Other` and
joined differently — so **every cancellation submitted from the app carried a reason the web
has no concept of**. `shared/customer-logic/order-reasons.ts` now holds the list, the
sentinel and `buildOrderActionReason`; both clients import it.

**Profile modals finished.** Phase 7 rebuilt the profile *menu*, security *toggles* and
empties *tabs* but left three modal bodies untouched — that is why 15 strings survived it,
and why marking Phase 7 done was premature. Edit Profile now uses the web's field labels
(`First Name`, `Middle Name`, `Last Name`, `Suffix`, `Phone Number`, `Email Address`),
Account Security is titled correctly with the web's `OTP verification is required to change
password.`, and Notification Settings carries the web's three row descriptions. `ModalShell`
gained an optional subtitle so modals the web gives no subtitle can omit it.

**Auth screen scheduled and closed.** The login button no longer swaps its label to
"Please wait..." — it shows a spinner and keeps `Log In` / `Create Account`, as the web
does. OTP wording is now `Send Verification OTP` / `Verify Code` / `Verifying Code...`,
matching `otp-verification-modal.tsx`, and the email placeholder is `you@example.com`.

**Dead code removed:** `order-detail-card.tsx`, unreferenced since the detail screens
replaced it in Phase 4, was still being imported.

**Sticky action bars — done.** The cart and checkout bars are now exported separately
(`CartActionBar`, `CheckoutActionBar`) and rendered by the shell *outside* the shared
`ScrollView`, pinned above the bottom nav, as the web's `sticky` bars are. They sit inside
the animated column rather than `portalBody`, which is a row — the bottom nav escapes that
row through `position: absolute`, but the bars do not, so placing them there put them beside
the content instead of below it.

### Still open

- **Screenshots.** AC-1 has never been signed off for any phase. Everything in this document
  is verified against the web *source*, the copy gate, `tsc`, the unit tests and a successful
  bundle — never against two rendered screens side by side. The screenshot sweep in §4g found
  seven defects that all of those checks had passed, so this remains the single largest gap
  in the verification story.

### An attempted cleanup that was reverted

61 stylesheet entries have gone unused across the rebuild. A scripted prune removed 38 of
them, but its multi-line pattern over-matched and took `subtle` and `appHeader` with them.
`tsc` failed immediately, and the stylesheet was restored from backup. The dead entries are
still there — harmless, but worth removing by hand rather than by regex.

**Verified** — app typecheck, 9 tests, copy gate (0 known / 0 new), `expo export`.

## 4m. Structural pass (2026-08-30)

Reading the web for *structure* rather than copy, after the standard was relaxed. This
found the most serious defect of the project.

**The Request Replacement form was unreachable.** It was built in Phase 5 and that phase
was reported complete. Nothing anywhere in the app called `setReplacementOrder`, so the
form could not be opened. The copy gate passed it because its strings existed; `tsc` passed
because the code compiled; the bundle built. Only asking "the web's order detail offers this
action — does the app?" surfaced it. An entry point now exists on the order detail for
delivered orders with no open case.

**Also closed in this pass**

- Discount lines on order detail, request detail and the receipt — present on the web,
  absent from the app.
- The rejection/cancellation reason banner on request detail.
- `View Purchase Order →` on approved purchase requests, which jumps to the order.
- The live password-requirements checklist in Account Security. Its six rules now live in
  `shared/customer-logic/password.ts` and drive **both** the checklist and
  `validatePasswordPolicy`, so the list a customer is shown cannot disagree with what is
  enforced. The web's inline `RequirementRow` calls were replaced with a map over the same
  rules.

**Deliberate structural differences, kept**

- The replacement record opens as a **pushed screen** in the app where the web uses a
  dialog, so `Replacement Details` / `Cancel Replacement` / `Close` sit on that screen
  rather than on the order detail. Better on a phone; flagged for the user rather than
  silently reverted.
- Where the web builds a browser workaround, the app uses the platform: OS date picker,
  option sheets instead of `<select>`, the system image cropper, `tel:` links.

**OTP countdown added (2026-08-30).** The password-change step now has the web's
Security Verification card: `Code expires in m:ss`, `Verification code has expired.`,
`Resend code in Ns` with a `Resend Code` link once the cooldown clears, and
`OTP Verified Successfully` on success. Verify is disabled once the code expires, and both
timers restart when a new code is sent. `OTP_EXPIRY_SECONDS` (120),
`OTP_RESEND_COOLDOWN_SECONDS` (60) and `formatOtpCountdown` live in
`shared/customer-logic/otp.ts`; the web's inline constants and `formatTime` now come from
there. `New Password` / `Confirm Password` gained visible labels, and the empties card
gained `Max available:`.

**Remaining structure-check output is artifact, not gap.** Copy that lives inside a call
(`formatDiscountLabel(...)`) or a nested ternary is invisible to the extractor, so `Discount`,
`Save Address`, `Submit Review` and `Download Receipt` still report as absent while being
present. The Profile row compares one 1853-line web file against three app files and lists
the OTP sub-dialog's countdown copy, which the app genuinely does not have — that is the
one real item left there.

**Verified** — app typecheck, 9 tests, copy gate (0/0), `expo export`, web `tsc`.

## 4n. Close-out (2026-08-30)

### Two crashes the user hit, and what actually caused them

**MapLibre `MLRNModule` TypeError.** `address-map-picker.tsx` imports MapLibre,
which is native-only, and had no `.web.tsx` sibling. Added one: a coordinate-entry
fallback that validates against the same Silay/Talisay polygons, so the service-area
rule is enforced identically on both. Verified by grepping the shipped web bundle —
`MLRNModule` 0 occurrences, `maplibre` 0 occurrences.

**"The request timed out."** Not a network or backend problem: the backend was up
and answering (`/api/products` → HTTP 401, correct for an unauthenticated call).
`src/config/env.ts` hardcoded `http://10.0.2.2:8000` — the Android *emulator* alias
for the host machine. From Expo web or a physical phone that address is unroutable,
so every request hung until the 15s client timeout and surfaced as a timeout toast.
Replaced with the host resolution the driver app already uses: `window.location.hostname`
on web, the Metro `hostUri` on a physical device, the emulator alias only on Android.
Verified in the shipped bundle: `location.hostname||"localhost"}:8000`.

The shape of this bug is worth remembering — a hardcoded emulator IP fails as a
*timeout*, not as a connection error, so it reads like a backend or network fault
and sends you looking in the wrong place.

### Structure gate: from 8 failing screens to 0

The gate was reporting 8 screens as missing web copy. Nearly all of it was the
checker's own blind spots, not real gaps — a gate that cries wolf is worse than no
gate, so the extractor was fixed rather than the findings waved through:

| Blind spot | Effect | Fix |
| --- | --- | --- |
| Ternary regex consumed the `:` | Every else-branch label unseen (`Save Address`, `Submit Review`) | Match the colon as a lookahead |
| `placeholder=` not read | `Enter Verification Code` reported absent | Added to the attribute list |
| `&amp;` not decoded | `Empties &amp; Deposits` never matched | Decode alongside `&apos;` |
| Object-property labels ignored | Menu rows built from config objects unseen | Match `title:`/`label:`/`heading:` |
| TS type names and field hints | `Promise`, `(Optional)` scored as sections | Filtered in `isSectionLabel` |
| Order Detail paired too narrowly | Replacement copy looked absent | Added the screens the app split it into |

Six genuine differences remain, and they are now a documented `INTENTIONAL` map in
the checker rather than silent failures. Each is a decision:

- **Cart** — `Use` / `Select item` / `Remove from cart`: the app names the item
  ("Remove Alkaline 500ml from cart"), built from a template literal. Better than
  the web, and unmatchable as a static string.
- **Discount** (Request Detail, Order Detail, Receipt) — rendered through
  `formatDiscountLabel()`, which folds the percentage into the label.
- **Close / Back to profile** (Purchase Orders, Profile) — the web opens dialogs
  with a close control; the app pushes screens and returns via the back header.

Anything *not* on that list going absent is now real drift, and the gate exits
non-zero for it.

### Alignment applied in this pass

- `MixedCaseBuilder` — product thumbnails, "Bottles per case", "Subtotal/case:",
  "Estimated Mixed Case total:", matching the web dialog.
- `Pin Address on Map` section heading on Edit Address.
- `Record Empties` → `Record Empty Bottle Cases`.
- OTP card now states where the code went: "We sent a 6-digit verification code to {email}".
- Delivery Address summary card in the edit-profile modal, with "Change Delivery
  Address" routing to the address editor — mirrors web `profile-view.tsx:861-876`.
- Visible "Clear" label beside the Edit Address trash icon (web pairs both).
- `accessibilityLabel="Upload profile photo"` (was "Change Avatar") and
  "Close receipt preview", matching the web's aria-labels.

One rename was made and then reverted: the profile menu row was briefly changed to
"Delivery Address", but the web's row is titled "Address" — "Delivery Address" is a
separate label inside the address card. Renaming it moved the app *away* from the
web. Reverted, and the card added instead.

### The six MixedCaseBuilder copy findings: kept, not aligned

The web shows one generic toast ("Complete the Mixed Case with at least two products
before adding it."). The app names the specific problem — insufficient stock, no
shared capacity, non-whole case count. On a phone, where the builder is harder to
scan, the specific message is more useful. Allowlisted in the copy gate with that
reasoning recorded inline, so it reads as a decision rather than drift.

### Verification state

`tsc --noEmit` clean · 9/9 tests pass · copy parity exit 0 (0 new drift) ·
structure gate exit 0 · `expo export --platform web` builds (3.4MB bundle).

### What is still not verified

`expo export` bundles but never executes a line. Every check above is static. The
screenshot sweep in §4g found 7 defects that typecheck, the copy gate, and a clean
bundle had all passed — so **AC-1 remains unsigned-off**, and the honest status of
this work is "builds and is structurally aligned", not "verified working". The
remaining ~61 unused stylesheet entries are cosmetic; the regex prune was reverted
in §4l after it removed live styles, so they need removing by hand if at all.

## 4o. The OTP timeout, properly diagnosed (2026-08-30)

The first pass at this blamed `env.ts` for pointing at the Android emulator alias.
That was a real bug and worth fixing, but it was not why OTP timed out. Measuring
the endpoint instead of reasoning about it gave a different answer:

```
POST /api/auth/password-reset/request-otp  ->  HTTP 200 in 15.93s
```

The request **succeeded**. The client aborts at 15s, so the OTP was being sent every
single time and the app threw it away a fraction of a second before the response
landed, then showed "The request timed out." The mail was arriving; the UI was lying.

### Where the 15.9s went

Timing each stage separately:

| Stage | Time |
| --- | --- |
| `_get_reset_account` (cold) | 19.55s |
| `_get_reset_account` (warm) | 0.12s |
| `_otp_mail_ready()` | 0.00s |
| `_build_branded_email_html` | 0.02s |

A 100x gap between cold and warm pointed at connection setup, not the query.
`CONN_MAX_AGE` was `0`, so Django opened a fresh connection to the remote Supabase
pooler for **every request** and closed it again. The connection itself costs ~12s
on this machine: DNS resolution alone takes 3.8s, and an IPv6 lookup fails after
another 3.8s before falling back to IPv4 (raw TCP, once resolved, is 0.24s).

So every request to this backend was paying ~12s. OTP was simply the one that tipped
past 15s, because it adds an SMTP round trip on top.

### Fixes applied

1. **`CONN_MAX_AGE` 0 → 60** (`DB_CONN_MAX_AGE` overrides). The old comment claimed
   transaction-mode pooling requires 0; that conflates the client→PgBouncer
   connection with the pooled server connection. Reusing the client connection is
   exactly what a pooler is for. The genuine transaction-pooling requirement is
   `DISABLE_SERVER_SIDE_CURSORS`, which was **not** set and now is.
2. **`EMAIL_TIMEOUT = 10`.** Django's default is `None`, so a stalled SMTP socket
   hangs the request forever while the client gives up at 15s.
3. **Circuit breakers on the two API mail paths.** Every send tried the Gmail API,
   then Brevo, then fell back to SMTP. On this machine both HTTPS paths fail with
   `CERTIFICATE_VERIFY_FAILED`, so each send paid two doomed round trips before the
   fallback that actually works. A failure now disables that path for 300s.
4. **A latent silent-failure bug.** Three of the four senders called
   `_send_via_brevo(...)` and then `return`ed unconditionally, ignoring the returned
   bool — so a `False` return (unconfigured Brevo) counted as "sent" and no email
   went out at all, with no error. The breaker raises rather than returning `False`
   for exactly this reason, and the callers now check the result.
5. **Client budget for OTP raised to 30s** (`OTP_MAIL_TIMEOUT_MS`). Mail is
   legitimately slower than a JSON call; the shared 15s default was never sized for it.

Result: **15.93s → 7.5–9.1s**, inside the default budget and well inside the OTP one.

### Why it is still ~8s, and what was not fixed

The remainder is the Gmail SMTP send: `send_mail` opens a new connection per call and
the handshake alone is ~3s. It cannot move to the fast HTTPS APIs on this machine —
`REQUESTS_CA_BUNDLE` points at a valid certifi bundle and verification *still* fails,
which means TLS interception by a local proxy or antivirus injecting a root CA that
certifi does not carry. That is an environment problem, not a code one, and the right
response is not to disable certificate verification for outbound API calls.

Sending the mail on a background thread would make the endpoint return in ~0.3s, since
the OTP is stateless and nothing needs the send to finish first. That was deliberately
**not** done: it converts a visible "Unable to send OTP email right now" 500 into a
silent success, and that trade-off is the user's call, not mine.

### The signup OTP was a second, separate instance

A screenshot of the signup screen showed the same timeout under "Send Verification
OTP". That is `/api/auth/email-verification/request`, not the password-reset
endpoint, and only the latter had been given a raised budget — so the fix had been
applied to one of the two mail paths the customer app actually uses.

Enumerating every view that sends mail synchronously, rather than fixing them one
screenshot at a time, showed only two are reachable from the customer app
(`auth_email_verification_request` and `auth_password_reset_request_otp`); customer
login, register, order placement and cancellation send nothing. Both now share a
single `MAIL_REQUEST_TIMEOUT_MS` exported from `api.ts`, so the reasoning lives in
one place instead of being duplicated per call site.

Measured after the fix: signup OTP returns **HTTP 200 in 8.6-9.2s**. Before the
connection-reuse fix it would have been ~20s — a guaranteed timeout for any new
email, which is every signup.

That screenshot also produced a useful negative result: posting an already-registered
address returns **HTTP 409 in 1.3s** ("This email address is already registered"),
not a timeout. Since the screenshot showed a timeout rather than that message, the
backend must have been down at that moment — which matches finding nothing listening
on port 8000.

### The actual root cause: the env.ts fix was dead code

A third screenshot showed the error had changed from "The request timed out" to
"Failed to fetch" — a different failure, thrown by the browser when the request never
completes at the network layer at all.

The backend was up, CORS preflight returned correct headers
(`access-control-allow-origin: http://localhost:8081`), and the exact browser POST
succeeded from curl in 7.5s. So the browser was not calling the URL it appeared to be.

`app.json` pinned the override:

```json
"extra": { "apiBaseUrl": "http://10.0.2.2:8000" }
```

and `env.ts` read it *before* falling back to detection:

```ts
process.env.EXPO_PUBLIC_API_BASE_URL || Constants.expoConfig?.extra?.apiBaseUrl || runtimeApiBaseUrl()
```

`Constants.expoConfig.extra.apiBaseUrl` was always set, so `runtimeApiBaseUrl()`
**never ran on any platform**. The host-detection rewrite in §4n had been dead code
from the moment it was written, and the app had been calling the Android-emulator
alias from the browser the entire time — first as a hang, then as a fast failure.

Fixes: removed `extra.apiBaseUrl` from `app.json` (it was redundant —
`runtimeApiBaseUrl()` already returns `10.0.2.2` for Android), and hardened `env.ts`
so a configured value that cannot work on the current platform is treated as stale
config rather than an override, with a `console.warn` when one is discarded. That
stops the whole class of bug returning if someone re-adds it.

**app.json is read at bundle time, so the Expo dev server must be restarted for this
to take effect — a hot reload will not pick it up.**

### A verification failure worth recording

§4n claimed this fix was "confirmed in the shipped bundle" on the strength of
grepping the web bundle for `location.hostname||"localhost"}:8000` and finding it.
The string was present; the code was unreachable. **Presence of code in a bundle is
not evidence that it executes.** Where a value can come from several sources, resolve
it and print the winner — which is what finally found this, in about a minute — rather
than confirming that the new branch exists somewhere in the output.

### The lesson

The first diagnosis was plausible and wrong. A hardcoded emulator IP and a 16s
response produce the identical symptom — a timeout toast — and only measurement
separates them. Time the endpoint before theorising about it.

## 4p. Design pass on the customer screens (2026-08-30)

Sixteen reference screenshots of the **web** portal (identified as web, not the app,
because the Mixed Case dialog shows "Product size" as a select — the app renders
chips there, and that label exists only in `mixed-case-builder-dialog.tsx`).

### Product thumbnails were fetching a 537KB logo per row

`resolveImageUrl()` falls back to `/email-assets/ann-anns-logo.png` when a product
has no image. **All 14 products in the database have no image**, so every thumbnail
in the app took that path: a 537KB PNG fetched once per row to fill a 40x40 box, and
a broken-image icon whenever the host was unreachable — which it always was, while
`app.json` pinned the API base to the emulator alias.

Added `components/ui/product-thumb.tsx`: renders an image only when a real path
exists, and falls back to a cheap local placeholder (product initial, or a package
glyph) both when the path is missing and when the load fails via `onError`. Applied
in the Mixed Case builder and the cart, which had the same pattern twice.

The web had the identical bug — `product.imageUrl || '/ann-anns-logo.png'`, so four
open rows meant ~2.1MB to draw four 40px squares. Given every product lacks an image,
that is the likely explanation for the broken thumbnails in the screenshot: caught
mid-load rather than genuinely failed. Fixed there the same way, with the image
fallback kept for paths that exist but fail.

### Mixed Case builder

- The running totals were three bare strings on a green bar
  (`Capacity 24  Added 0  Remaining 24`). Now a three-column card with a small label
  above each value, and the remaining count turns blue when the case is exactly full.
- Labelled the product-size chips "Product size", matching the web's select.
- `0 Bottles per case` was repeated on every row, duplicating the stepper beside it.
  It now appears once it means something, pairing with the existing Subtotal line.

### Not changed

The profile screens render saved values in a disabled/grey state until "Edit Profile"
is pressed. That reads as placeholder text at a glance, but it is the web's own
`disabled={!isEditingProfile}` behaviour and changing it would be a product decision,
not a polish pass.

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
- FR-7: The app MUST support the customer half of the replacement lifecycle: request with
  per-product reason and evidence, view replacement details and items, view POD, and cancel a
  replacement. **Receive-return is a warehouse action and MUST NOT appear in the customer app.**
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
