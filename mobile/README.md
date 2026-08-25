# Mobile Apps (React Native + Expo)

This folder contains the native app frontends:

- `driver-app` for driver operations
- `customer-app` for customer order and tracking

Both apps are connected to the Django backend.

## 1) Start Django backend first

```powershell
cd C:\CAPSTONE\backend
python manage.py runserver 0.0.0.0:8000
```

## 2) Configure API base URL (optional)

The driver app now selects a reachable development backend automatically:

- Expo web uses the browser hostname on port `8000`.
- A physical phone running through Expo uses the Metro development-server hostname on port `8000`.
- An Android emulator falls back to `http://10.0.2.2:8000`.

For a physical phone, Django must listen on the LAN interface using `python manage.py runserver 0.0.0.0:8000`.

Override if needed:

```powershell
$env:EXPO_PUBLIC_API_BASE_URL='http://<YOUR_PC_IP>:8000'
```

Use your LAN IP when testing on physical devices.

## 3) Run driver app

```powershell
cd C:\CAPSTONE\mobile\driver-app
npm install
npx expo start
```

The driver app is a separate React Native implementation of the Driver Portal. It includes driver-only login and 2FA, password recovery, remembered Android sessions protected by Android Keystore, assigned trips, trip start/status workflows, foreground/background GPS reporting, offline mutation sync, native route navigation, proof-of-delivery photos, history, notifications, profile, settings, and logout.

For the native map, background location, camera, and Keystore-backed session storage, run a native Android development build rather than Expo Go:

```powershell
npm run android
```

The web Driver Portal under `src/components/portals/driver` is not imported or modified by this mobile application.

Default demo login:

- `driver@logistics.com`
- `driver123`

## 4) Run customer app

```powershell
cd C:\CAPSTONE\mobile\customer-app
npm install
npx expo start
```

Default demo login:

- `customer@example.com`
- `customer123`
