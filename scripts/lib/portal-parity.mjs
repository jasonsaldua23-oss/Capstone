// Shared machinery for the web-portal / Expo-app structural comparisons.
//
// The parity standard is "similar structure", not identical pixels or wording, so
// these helpers report the ordered sequence of sections a screen renders. They
// deliberately say nothing about styling or exact copy.
//
// Used by check-customer-structure.mjs and check-driver-structure.mjs.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(fileURLToPath(new URL("..", import.meta.url)), "..");

// Section labels are short, title-ish strings — the headings a reader would use to
// describe the page. Long sentences are body copy, not structure.
export function isSectionLabel(text) {
  const t = text.trim();
  if (t.length < 3 || t.length > 42) return false;
  if (!/^[A-Z(]/.test(t)) return false;
  if (/[.!?]$/.test(t)) return false; // full sentences are copy
  if (/(===|=>|\|\||&&|\$|`|=)/.test(t)) return false;
  if (/\b(const|return|import|export|function|type)\b/.test(t)) return false;
  if (/^\d/.test(t)) return false;
  if (/^\(.*\)$/.test(t)) return false; // "(Optional)" is a field hint, not a section
  if (/^(Promise|File|Blob|Error|Record|Partial|Array|Boolean|Number|String)$/.test(t)) return false; // TS types
  // Headings may be all-caps ("PRODUCT", "TOTAL PRICE"); require letters, not lowercase.
  return /[A-Za-z]{3}/.test(t);
}

// Pull the section labels out of a block of source, in document order.
export function sectionsOfSource(source) {
  const cleaned = source.replace(/^[ \t]*\/\/.*$/gm, "");
  const found = [];
  const seen = new Set();
  const push = (raw) => {
    const text = raw.replace(/\s+/g, " ").replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim();
    if (!isSectionLabel(text)) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    found.push(text);
  };

  // JSX text nodes, in document order.
  for (const m of cleaned.matchAll(/[>}]\s*([^<>{}\n][^<>{}]*?)\s*[<{]/g)) push(m[1]);
  // Labelled props that name a section for the reader.
  // `title` on the web often becomes `accessibilityLabel` in the app; treat both as
  // naming the same affordance.
  for (const m of cleaned.matchAll(/(?:title|label|subtitle|caption|accessibilityLabel|placeholder)\s*=\s*["']([^"']+)["']/g)) push(m[1]);
  // Menu rows are built from config objects, not JSX attributes: { title: "Delivery Address" }.
  for (const m of cleaned.matchAll(/(?:title|label|heading)\s*:\s*["']([^"']+)["']/g)) push(m[1]);
  // Copy inside a ternary — {saving ? "Saving..." : "Save Address"} — is still a
  // section label; the JSX scan cannot see it because it sits between braces.
  // The colon is a lookahead: consuming it would swallow the separator the
  // else-branch pattern needs, so every else label went unseen and screens were
  // reported as missing copy they actually render.
  // A nested ternary closes with ")" rather than "}" or a newline —
  //   const text = label || (failed ? "Failed" : "Delivered");
  // so the else-branch label went unseen and read as missing from the app.
  for (const m of cleaned.matchAll(/\?\s*"([^"]{3,42})"\s*(?=:)|:\s*"([^"]{3,42})"\s*[}\n)]/g)) push(m[1] || m[2]);
  return found;
}

export function sectionsOf(file) {
  return sectionsOfSource(readFileSync(join(ROOT, file), "utf8"));
}

/**
 * Sections of one region of a file.
 *
 * The driver app renders every screen from a single App.tsx, so a whole-file scan
 * would report each screen as containing every other screen's copy. A region is the
 * slice from the first line matching `from` up to the next line matching any of
 * `until` — which is how the per-screen branches in that file are delimited.
 */
export function sectionsOfRegion({ file, from, until = [] }) {
  const lines = readFileSync(join(ROOT, file), "utf8").split(/\r?\n/);
  const start = lines.findIndex((line) => line.includes(from));
  if (start === -1) throw new Error(`region start not found in ${file}: ${from}`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (until.some((marker) => lines[i].includes(marker))) {
      end = i;
      break;
    }
  }
  return sectionsOfSource(lines.slice(start, end).join("\n"));
}

export function sectionsOfSource_(source) {
  return sectionsOfSource(source);
}

/** Resolve one app source, which is either a file path or a region spec. */
export function sectionsOfAppSource(source) {
  return typeof source === "string" ? sectionsOf(source) : sectionsOfRegion(source);
}

/**
 * Compare each screen and print the report. Returns the number of screens with web
 * sections the app does not render.
 */
export function reportParity({ screens, intentional = {}, only }) {
  let mismatches = 0;

  for (const [name, webFile, appSources] of screens) {
    if (only && !name.toLowerCase().includes(only)) continue;

    let web, app;
    try {
      web = sectionsOf(webFile);
      app = [...new Set(appSources.flatMap((s) => sectionsOfAppSource(s)))];
    } catch (error) {
      console.log(`\n## ${name}\n   !! ${error.message}`);
      mismatches += 1;
      continue;
    }

    const webSet = new Set(web.map((s) => s.toLowerCase()));
    const appSet = new Set(app.map((s) => s.toLowerCase()));
    const allowed = new Set((intentional[name] || []).map((s) => s.toLowerCase()));
    const missingInApp = web.filter((s) => !appSet.has(s.toLowerCase()) && !allowed.has(s.toLowerCase()));
    const extraInApp = app.filter((s) => !webSet.has(s.toLowerCase()));

    const status = missingInApp.length === 0
      ? allowed.size > 0 ? `aligned (${allowed.size} documented difference(s))` : "aligned"
      : `${missingInApp.length} web section(s) absent`;
    console.log(`\n## ${name} — ${status}`);
    console.log(`   web: ${web.join(" | ") || "(none)"}`);
    console.log(`   app: ${app.join(" | ") || "(none)"}`);
    if (missingInApp.length > 0) {
      console.log(`   absent from app: ${missingInApp.join(", ")}`);
      mismatches += 1;
    }
    if (extraInApp.length > 0) console.log(`   app-only: ${extraInApp.join(", ")}`);
  }

  return mismatches;
}
