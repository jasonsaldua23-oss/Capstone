// Resolves the Google OAuth client ID at config time and publishes it on `extra`.
//
// Relying on mobile/customer-app/.env alone was fragile: EXPO_PUBLIC_* values are
// read when the dev server starts, so creating or editing that file while Metro is
// already running leaves the app with an empty client ID and the misleading message
// "Google sign-in is not configured yet" — which looks like missing credentials
// rather than a stale process.
//
// The repo root .env is the single source of truth the project already maintains,
// so fall back to it. A client ID is public by design (it ships in the browser
// bundle); the client SECRET is never read here and stays server-side.
const fs = require("fs");
const path = require("path");

function readEnvFile(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function valueOf(contents, key) {
  const match = contents.match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!match) return "";
  return match[1].trim().replace(/^["']|["']$/g, "");
}

function resolveGoogleClientId() {
  if (process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID) return process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;

  const candidates = [
    path.resolve(__dirname, ".env"),
    path.resolve(__dirname, "../../.env"),
  ];
  const keys = ["EXPO_PUBLIC_GOOGLE_CLIENT_ID", "NEXT_PUBLIC_GOOGLE_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID"];

  for (const file of candidates) {
    const contents = readEnvFile(file);
    if (!contents) continue;
    for (const key of keys) {
      const value = valueOf(contents, key);
      if (value) return value;
    }
  }
  return "";
}

module.exports = ({ config }) => {
  const googleClientId = resolveGoogleClientId();
  if (!googleClientId) {
    console.warn("[app.config] No Google OAuth client ID found; Google sign-in will be hidden.");
  }

  // NOTE: `extra` reaches native builds but is NOT embedded in Expo's static web
  // export — only EXPO_PUBLIC_* values are inlined there, by babel-preset-expo,
  // and its workers are separate processes so seeding process.env here does not
  // reach them (measured: the client ID was absent from the exported web bundle).
  // Web therefore requires EXPO_PUBLIC_GOOGLE_CLIENT_ID in mobile/customer-app/.env,
  // read when the dev server starts. This block exists to make a missing or stale
  // value loud instead of surfacing as "not configured".
  if (!process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID && googleClientId) {
    console.warn(
      "[app.config] Found a Google client ID in .env but EXPO_PUBLIC_GOOGLE_CLIENT_ID " +
        "is not set in this process. Web builds will hide the Google button. " +
        "Ensure mobile/customer-app/.env defines it, then restart with: npx expo start -c",
    );
  }
  return {
    ...config,
    // Fix build 2 can replace the already-installed build 1 on the phone.
    android: {
      ...(config.android || {}),
      versionCode: 2,
    },
    plugins: [
      ...(config.plugins || []),
      // Fix: the installed APK calls the LAN backend over HTTP, which Android 9+ blocks by default.
      ["expo-build-properties", { android: { usesCleartextTraffic: true } }],
    ],
    extra: {
      ...(config.extra || {}),
      googleClientId,
    },
  };
};
