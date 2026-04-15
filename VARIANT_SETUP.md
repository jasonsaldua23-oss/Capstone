# Variant Setup (Admin Web / Driver App / Customer App)

## 1) Frontend Variant Lock
Set `NEXT_PUBLIC_APP_VARIANT` when running/building:

- `admin` -> allows `admin`, `warehouse`
- `driver` -> allows only `driver`
- `customer` -> allows only `customer`
- `all` (default) -> allows all portals

Windows scripts already added:

- `npm run dev:admin`
- `npm run dev:driver`
- `npm run dev:customer`
- `npm run build:admin`
- `npm run build:driver`
- `npm run build:customer`

## 2) Capacitor Variant
Set `APP_VARIANT` for Capacitor app identity:

- `driver` -> `com.logitrack.driver`
- `customer` -> `com.logitrack.customer`
- `admin` -> `com.logitrack.admin`

Windows scripts already added:

- `npm run cap:sync:android:driver`
- `npm run cap:sync:android:customer`
- `npm run cap:run:android:driver`
- `npm run cap:run:android:customer`

You can override `CAP_SERVER_URL` per build target if needed.

## 3) Recommended Production Deploys

- Admin web deploy: build with `NEXT_PUBLIC_APP_VARIANT=admin`
- Driver web deploy (for app webview URL): build with `NEXT_PUBLIC_APP_VARIANT=driver`
- Customer web deploy (for app webview URL): build with `NEXT_PUBLIC_APP_VARIANT=customer`
