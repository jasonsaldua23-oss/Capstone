// Copy-parity check for the Expo customer app against the web customer portal.
//
// FR-2 requires user-visible copy to match the web portal string-for-string, and
// §8 of docs/mobile-customer-web-parity-spec.md names this check as the mitigation
// that stops the two from drifting again after each phase lands.
//
// It extracts literal user-visible strings from both sides and reports app strings
// that have no counterpart on the web. It is deliberately conservative: dynamic
// template strings, single words, and anything under the length floor are skipped,
// because those produce noise rather than findings.
//
//   node scripts/check-customer-copy-parity.mjs [--verbose]

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const WEB_DIRS = [
  "src/components/portals/customer",
  "src/components/portals/shared",
  "src/components/auth",
];
const APP_DIRS = ["mobile/customer-app/src/screens", "mobile/customer-app/src/components/ui"];
const APP_FILES = ["mobile/customer-app/App.tsx", "mobile/customer-app/src/portal/portal-modals.tsx"];

// Copy that is legitimately app-only: platform affordances the web has no equivalent
// for, because the browser provides them natively.
const ALLOWED_APP_ONLY = new Set([
  "Filter by category", // the web <select>'s own label; native needs a visible sheet title
  "Select a date", // empty-state of the native date field; <input type="date"> renders its own
  "Select date",
  "Go back", // accessibility label for the native back affordance
  "Back to cart",
  "Back to catalog",
  "Back to orders",
  "Call driver",
  "Open cart",
  "Notifications",
  "Increase quantity",
  "Decrease quantity",
  "Select all",
  "Starting customer app...", // native splash; the web has no cold-start state
  "Preparing PDF...", // expo-print export; the web downloads a PNG via html-to-image
  "Uploading...", // the app uploads to the server; the web file input is instant
]);

// Known drift in screens that have not been rebuilt yet, tagged with the phase that
// closes it. Delete entries as their phase lands; the check fails on anything new, so
// a finished screen cannot quietly regress. An entry left here after its phase ships
// is itself a bug — the phase did not finish.
//
// Empty as of Phase 9: every screen has been rebuilt, so any finding is new drift.
const PENDING_BY_PHASE = new Map([]);

const PENDING = new Map();
for (const [phase, items] of PENDING_BY_PHASE) {
  for (const item of items) PENDING.set(item, phase);
}

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(tsx|ts)$/.test(full) && !/\.test\./.test(full)) out.push(full);
  }
  return out;
}

function normalize(value) {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

// A string is "interesting" if a user could read it and notice it changed.
function isInteresting(value) {
  const text = normalize(value);
  if (text.length < 6) return false;
  if (!/[a-z]/.test(text)) return false; // skip SCREAMING_CONSTANTS and codes
  if (!/\s/.test(text) && text.length < 12) return false; // skip lone identifiers
  if (/^[a-z]+([A-Z][a-z]+)+$/.test(text)) return false; // camelCase identifiers
  if (/^(https?:|\/|#|rgba?\(|[0-9.]+$)/.test(text)) return false;
  // Code fragments the JSX text scan can pick up between braces.
  if (/(===|!==|=>|\|\||&&|\?\.|\);|\.\w+\(|\w+\.\w+)/.test(text)) return false;
  if (/\b(export|import|const|return|function|type|interface)\b/.test(text)) return false;
  // JSX ternary punctuation, e.g. ") : replacement ? ("
  if (/^[)(\s]*[:?]/.test(text) || /[:?]\s*[()]\s*$/.test(text)) return false;
  // Attribute regions and template-literal fragments the `{`-terminated scan can
  // reach: real copy never contains `=`, a backtick, or `$`.
  if (/[=`$]/.test(text)) return false;
  // A call or statement fragment, e.g. "void persistNotificationPreferences("
  if (/\($/.test(text) || /^(void|await|new)\s/.test(text)) return false;
  // Inline type annotations, e.g. "void; submitting: boolean; ..."
  if (/;/.test(text) && /:/.test(text)) return false;
  if (/^[\w.-]+\.(png|jpg|jpeg|svg|ttf)$/i.test(text)) return false;
  return true;
}

function extractStrings(file) {
  // Strip whole-line `//` comments so notes about the code are not read as copy.
  // Block comments are deliberately left alone: a stray `/*` in a string or regex
  // makes a non-greedy strip swallow real markup (it ate 16KB of profile-view.tsx).
  const source = readFileSync(file, "utf8").replace(/^[ \t]*\/\/.*$/gm, "");
  const found = new Set();

  // JSX text nodes. Copy can start after `>` or after an expression's `}`, and can
  // end at the next tag `<` or the next expression `{` — e.g. `Reported on {date}`.
  for (const match of source.matchAll(/[>}]\s*([^<>{}\n][^<>{}]*?)\s*[<{]/g)) {
    if (isInteresting(match[1])) found.add(normalize(match[1]));
  }
  // Quoted props users read, plus plain string literals in copy position.
  for (const match of source.matchAll(
    /(?:placeholder|title|label|subtitle|message|confirmLabel|description|accessibilityLabel)\s*=\s*["']([^"']+)["']/g
  )) {
    if (isInteresting(match[1])) found.add(normalize(match[1]));
  }
  for (const match of source.matchAll(/["']([A-Z][^"'`\n]{5,90})["']/g)) {
    if (isInteresting(match[1])) found.add(normalize(match[1]));
  }
  return found;
}

function collect(paths) {
  const strings = new Map(); // text -> Set(files)
  for (const path of paths) {
    const abs = join(ROOT, path);
    const files = statSync(abs).isDirectory() ? walk(abs) : [abs];
    for (const file of files) {
      for (const text of extractStrings(file)) {
        if (!strings.has(text)) strings.set(text, new Set());
        strings.get(text).add(relative(ROOT, file));
      }
    }
  }
  return strings;
}

const webStrings = collect(WEB_DIRS);
const appStrings = collect([...APP_DIRS, ...APP_FILES]);

// Match loosely on the web side: the app may render a fragment the web composes
// from several nodes, so a substring hit in either direction counts as present.
const webList = [...webStrings.keys()];
const missing = [];
for (const [text, files] of appStrings) {
  if (ALLOWED_APP_ONLY.has(text)) continue;
  if (webStrings.has(text)) continue;
  const loose = webList.some((web) => web.includes(text) || text.includes(web));
  if (!loose) missing.push({ text, files: [...files] });
}

missing.sort((a, b) => a.text.localeCompare(b.text));

const verbose = process.argv.includes("--verbose");
const unexpected = missing.filter(({ text }) => !PENDING.has(text));
const known = missing.filter(({ text }) => PENDING.has(text));
const fixed = [...PENDING.keys()].filter((text) => !appStrings.has(text));

console.log(`web strings:   ${webStrings.size}`);
console.log(`app strings:   ${appStrings.size}`);
console.log(`known drift:   ${known.length} (scheduled)`);
console.log(`new drift:     ${unexpected.length}\n`);

if (verbose && known.length > 0) {
  const byPhase = new Map();
  for (const { text } of known) {
    const phase = PENDING.get(text);
    if (!byPhase.has(phase)) byPhase.set(phase, []);
    byPhase.get(phase).push(text);
  }
  for (const [phase, items] of [...byPhase].sort()) {
    console.log(`${phase}: ${items.length}`);
    for (const text of items.sort()) console.log(`    ${JSON.stringify(text)}`);
    console.log();
  }
}

if (fixed.length > 0) {
  console.log("Baseline entries no longer in the app — delete them from PENDING_BY_PHASE:\n");
  for (const text of fixed.sort()) console.log(`  ${JSON.stringify(text)}`);
  console.log();
}

if (unexpected.length > 0) {
  console.log("NEW app copy with no counterpart in the web portal:\n");
  for (const { text, files } of unexpected) {
    console.log(`  ${JSON.stringify(text)}`);
    console.log(`      ${files.join(", ")}`);
  }
  console.log("\nEither match the web wording, or add it to ALLOWED_APP_ONLY with a reason.");
}

// Stale baseline entries are a failure too: they mean a phase claimed a screen it left behind.
process.exit(unexpected.length > 0 || fixed.length > 0 ? 1 : 0);
