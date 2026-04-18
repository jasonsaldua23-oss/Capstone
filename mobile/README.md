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

By default, apps use `http://10.0.2.2:8000` (Android emulator -> host machine).

Override if needed:

```powershell
set EXPO_PUBLIC_API_BASE_URL=http://<YOUR_PC_IP>:8000
```

Use your LAN IP when testing on physical devices.

## 3) Run driver app

```powershell
cd C:\CAPSTONE\mobile\driver-app
npm install
npx expo start
```

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
