import type { CapacitorConfig } from '@capacitor/cli'

type AppVariant = 'driver' | 'customer' | 'admin'

const variant = (process.env.APP_VARIANT || 'driver').toLowerCase() as AppVariant

const variantConfig: Record<AppVariant, { appId: string; appName: string; defaultServerUrl: string }> = {
  driver: {
    appId: 'com.logitrack.driver',
    appName: 'LogiTrack Driver',
    defaultServerUrl: 'http://172.16.223.183:3000/login/driver',
  },
  customer: {
    appId: 'com.logitrack.customer',
    appName: 'LogiTrack Customer',
    defaultServerUrl: 'http://172.16.223.183:3000/login/customer',
  },
  admin: {
    appId: 'com.logitrack.admin',
    appName: 'LogiTrack Admin',
    defaultServerUrl: 'http://172.16.223.183:3000/login/admin',
  },
}

const selected = variantConfig[variant] || variantConfig.driver
const serverUrl = process.env.CAP_SERVER_URL || selected.defaultServerUrl
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
  server: {
    url: serverUrl,
    cleartext: isHttp,
    androidScheme: isHttp ? 'http' : 'https',
    allowNavigation,
  },
}

export default config
