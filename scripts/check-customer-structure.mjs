// Structural comparison between the web customer portal and the Expo customer app.
//
// The parity standard is "similar structure", not identical pixels or wording, so
// this reports the ordered sequence of sections each screen renders and pairs them
// up. It answers: does the app show the same things, in the same order, per screen?
// It deliberately says nothing about styling or exact copy.
//
//   node scripts/check-customer-structure.mjs [screen]

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

// Each pair is one customer-facing screen.
const SCREENS = [
  ["Home", "src/components/portals/customer/sections/home/home-view.tsx", [
    "mobile/customer-app/src/screens/home/home-screen.tsx",
    "mobile/customer-app/src/components/ui/category-select.tsx",
  ]],
  ["Cart", "src/components/portals/customer/sections/cart/cart-view.tsx", [
    "mobile/customer-app/src/screens/cart/cart-screen.tsx",
  ]],
  ["Checkout", "src/components/portals/customer/sections/checkout/checkout-view.tsx", [
    "mobile/customer-app/src/screens/checkout/checkout-screen.tsx",
    "mobile/customer-app/src/components/ui/date-field.tsx",
  ]],
  ["Purchase Requests", "src/components/portals/customer/sections/purchase-requests/purchase-request-view.tsx", [
    "mobile/customer-app/src/screens/purchase-requests/requests-screen.tsx",
    "mobile/customer-app/src/components/ui/pagination.tsx",
  ]],
  ["Request Detail", "src/components/portals/customer/sections/purchase-requests/purchase-request-detail-page.tsx", [
    "mobile/customer-app/src/screens/purchase-requests/request-detail-screen.tsx",
  ]],
  ["Purchase Orders", "src/components/portals/customer/sections/orders/orders-view.tsx", [
    "mobile/customer-app/src/screens/orders/orders-screen.tsx",
    "mobile/customer-app/src/screens/orders/replacement-detail-screen.tsx",
    "mobile/customer-app/src/components/ui/pagination.tsx",
  ]],
  ["Order Detail", "src/components/portals/customer/sections/orders/order-detail-page.tsx", [
    "mobile/customer-app/src/screens/orders/order-detail-screen.tsx",
    "mobile/customer-app/src/components/ui/replacement-request-form.tsx",
  ]],
  ["Track", "src/components/portals/customer/sections/track/track-view.tsx", [
    "mobile/customer-app/src/screens/track/track-screen.tsx",
  ]],
  ["Profile", "src/components/portals/customer/sections/profile/profile-view.tsx", [
    "mobile/customer-app/src/screens/profile/profile-screen.tsx",
    "mobile/customer-app/src/components/ui/empties-deposits.tsx",
    "mobile/customer-app/src/portal/portal-modals.tsx",
  ]],
  ["Edit Address", "src/components/portals/customer/sections/profile/edit-address-page.tsx", [
    "mobile/customer-app/src/screens/profile/edit-address-screen.tsx",
    "mobile/customer-app/src/components/ui/address-map-picker.tsx",
  ]],
  ["Feedback", "src/components/portals/customer/sections/feedback/feedback-view.tsx", [
    "mobile/customer-app/src/screens/feedback/feedback-screen.tsx",
  ]],
  ["Rating", "src/components/portals/customer/sections/orders/rating-dialog.tsx", [
    "mobile/customer-app/src/components/ui/rating-dialog.tsx",
  ]],
  ["Receipt", "src/components/portals/customer/sections/orders/receipt-dialog.tsx", [
    "mobile/customer-app/src/components/ui/receipt-dialog.tsx",
  ]],
];

// Section labels are short, title-ish strings — the headings a reader would use to
// describe the page. Long sentences are body copy, not structure.
function isSectionLabel(text) {
  const t = text.trim();
  if (t.length < 3 || t.length > 42) return false;
  if (!/^[A-Z(]/.test(t)) return false;
  if (/[.!?]$/.test(t)) return false; // full sentences are copy
  if (/(===|=>|\|\||&&|\$|`|=)/.test(t)) return false;
  if (/\b(const|return|import|export|function|type)\b/.test(t)) return false;
  if (/^\d/.test(t)) return false;
  // Headings may be all-caps ("PRODUCT", "TOTAL PRICE"); require letters, not lowercase.
  return /[A-Za-z]{3}/.test(t);
}

function sectionsOf(file) {
  const source = readFileSync(join(ROOT, file), "utf8").replace(/^[ \t]*\/\/.*$/gm, "");
  const found = [];
  const seen = new Set();
  const push = (raw) => {
    const text = raw.replace(/\s+/g, " ").replace(/&apos;/g, "'").trim();
    if (!isSectionLabel(text)) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    found.push(text);
  };

  // JSX text nodes, in document order.
  for (const m of source.matchAll(/[>}]\s*([^<>{}\n][^<>{}]*?)\s*[<{]/g)) push(m[1]);
  // Labelled props that name a section for the reader.
  // `title` on the web often becomes `accessibilityLabel` in the app; treat both as
  // naming the same affordance.
  for (const m of source.matchAll(/(?:title|label|subtitle|accessibilityLabel)\s*=\s*["']([^"']+)["']/g)) push(m[1]);
  // Copy inside a ternary — {cond ? "Save Address" : "Saving..."} — is still a section
  // label; the JSX scan cannot see it because it sits between braces.
  for (const m of source.matchAll(/\?\s*"([^"]{3,42})"\s*:|:\s*"([^"]{3,42})"\s*[}\n]/g)) push(m[1] || m[2]);
  return found;
}

const only = process.argv[2]?.toLowerCase();
let mismatches = 0;

for (const [name, webFile, appFiles] of SCREENS) {
  if (only && !name.toLowerCase().includes(only)) continue;

  let web, app;
  try {
    web = sectionsOf(webFile);
    app = [...new Set(appFiles.flatMap((f) => sectionsOf(f)))];
  } catch (error) {
    console.log(`\n## ${name}\n   !! ${error.message}`);
    mismatches += 1;
    continue;
  }

  const webSet = new Set(web.map((s) => s.toLowerCase()));
  const appSet = new Set(app.map((s) => s.toLowerCase()));
  const missingInApp = web.filter((s) => !appSet.has(s.toLowerCase()));
  const extraInApp = app.filter((s) => !webSet.has(s.toLowerCase()));

  const status = missingInApp.length === 0 ? "aligned" : `${missingInApp.length} web section(s) absent`;
  console.log(`\n## ${name} — ${status}`);
  console.log(`   web: ${web.join(" | ") || "(none)"}`);
  console.log(`   app: ${app.join(" | ") || "(none)"}`);
  if (missingInApp.length > 0) {
    console.log(`   absent from app: ${missingInApp.join(", ")}`);
    mismatches += 1;
  }
  if (extraInApp.length > 0) console.log(`   app-only: ${extraInApp.join(", ")}`);
}

console.log(`\nScreens with sections missing from the app: ${mismatches}`);
process.exit(mismatches > 0 ? 1 : 0);
