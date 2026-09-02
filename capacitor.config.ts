import type { CapacitorConfig } from '@capacitor/cli'

/**
 * One Capacitor project, built per portal.
 *
 * `APP_VARIANT` picks which app is being packaged, exactly as the `cap:*:driver`
 * and `cap:*:customer` npm scripts do. The shells load the deployed portal rather
 * than a bundled copy, so the apps and the browser always run the same code against
 * the same backend; `CAP_SERVER_URL` points them at a local machine during
 * development.
 */

type AppVariant = 'driver' | 'customer' | 'admin'

const variant = (process.env.APP_VARIANT || 'driver').toLowerCase() as AppVariant

const PRODUCTION_ORIGIN = 'https://annannsbeveragestrading.com'

const variantConfig: Record<AppVariant, { appId: string; appName: string; path: string }> = {
  driver: {
    appId: 'com.logitrack.driver',
    appName: 'AAB Trading Driver',
    path: '/login/driver',
  },
  customer: {
    appId: 'com.logitrack.customer',
    appName: 'AAB Trading Shop',
    path: '/login/customer',
  },
  admin: {
    appId: 'com.logitrack.admin',
    appName: 'AAB Trading Admin',
    path: '/login/admin',
  },
}

const selected = variantConfig[variant] || variantConfig.driver
const serverUrl = process.env.CAP_SERVER_URL || `${PRODUCTION_ORIGIN}${selected.path}`
const isHttp = serverUrl.startsWith('http://')

let allowNavigation: string[] = []
try {
  allowNavigation = [new URL(serverUrl).host]
} catch {
  allowNavigation = []
}

const config: CapacitorConfig = {
  appId: selected.appId,
  appName: selected.appName,
  webDir: 'cap-web',
  // The portal is loaded from the network, so it identifies the shell by this token
  // as well as by the injected bridge. Without it a page whose bridge has not run
  // would look like an ordinary browser tab and be offered a PWA install.
  appendUserAgent: 'AABTradingApp',
  android: {
    appendUserAgent: 'AABTradingApp',
  },
  ios: {
    appendUserAgent: 'AABTradingApp',
  },
  server: {
    url: serverUrl,
    // Plain http is only tolerated for local development servers.
    cleartext: isHttp,
    androidScheme: isHttp ? 'http' : 'https',
    allowNavigation,
  },
  plugins: {
    PushNotifications: {
      // Show the alert and badge for a notification that arrives while the app is
      // in the foreground; without this the payload is delivered silently.
      presentationOptions: ['alert', 'badge', 'sound'],
    },
  },
}

export default config
