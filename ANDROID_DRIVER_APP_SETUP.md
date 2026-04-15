# Android Driver App (Forced Camera Permission)

This project now includes a native Android permission gate in `DriverPortal`.  
On Android Capacitor builds, the Driver Portal is blocked until camera permission is granted.

## 1. Install packages

```bash
npm.cmd install
```

## 2. Create Android project (first time only)

```bash
npx cap add android
```

## 3. Sync Capacitor plugins

```bash
npm.cmd run cap:sync:android
```

## 4. Open Android Studio

```bash
npm.cmd run cap:open:android
```

## 5. Run on phone

- Connect phone via USB (or wireless debugging)
- Run from Android Studio

## Notes

- `capacitor.config.ts` currently points to `http://172.16.223.183:3000`.
- This native build uses live server mode (`server.url`), so your laptop server must be running:

```bash
npm.cmd run dev:phone
```
- If your laptop hotspot IP changes, set:

```bash
set CAP_SERVER_URL=http://YOUR_NEW_IP:3000
npm.cmd run cap:sync:android
```
