# LogiTrack Pro — Project Structure

## Root Layout

```
c:\CAPSTONE\
├── src/                    # Next.js frontend source
├── backend/                # Django REST API
├── mobile/                 # React Native apps (customer + driver)
├── android/                # Capacitor Android project
├── prisma/                 # Prisma schema, migrations, seed
├── public/                 # Static assets (logos, geo JSON, uploads)
├── certificates/           # Local HTTPS certs for LAN dev
├── middleware.ts           # Next.js edge middleware (auth + variant routing)
├── next.config.ts          # Rewrites all /api/* → Django on port 8000
├── capacitor.config.ts     # Capacitor config for Android builds
└── .env                    # Environment variables
```

## Frontend — `src/`

```
src/
├── app/
│   ├── page.tsx            # Root: AuthContext + PortalContext + portal switcher
│   ├── layout.tsx          # HTML shell, global CSS
│   ├── globals.css         # Tailwind base styles
│   └── login/
│       ├── admin/page.tsx
│       ├── warehouse/page.tsx
│       ├── driver/page.tsx
│       └── customer/page.tsx
├── components/
│   ├── portals/
│   │   ├── admin/          # AdminPortal + sections/
│   │   ├── warehouse/      # WarehousePortal + sections/
│   │   ├── driver/         # DriverPortal + sections/
│   │   └── customer/       # CustomerPortal + sections/
│   ├── auth/               # Per-portal login page components
│   ├── maps/               # AddressMapPicker, DriverRouteMap
│   ├── shared/             # LiveTrackingMap
│   └── ui/                 # shadcn/ui primitives
├── hooks/
│   ├── use-toast.ts
│   └── use-mobile.ts
├── lib/
│   ├── app-variant.ts      # Variant → allowed portals mapping
│   ├── client-auth.ts      # Tab-scoped JWT token + fetch interceptor
│   ├── client-image.ts     # Image URL helpers
│   ├── data-sync.ts        # Polling / sync utilities
│   ├── password-policy.ts  # Password validation rules
│   └── utils.ts            # cn() and misc helpers
├── stores/                 # (reserved for Zustand/state stores)
├── styles/                 # Additional CSS
└── types/
    ├── index.ts            # All shared TypeScript types & interfaces
    └── leaflet-css.d.ts    # Leaflet CSS module declaration
```

### Portal Section Pattern

Each portal follows the same internal structure:

```
portals/<portal>/
├── <Portal>Portal.tsx      # Top-level shell: sidebar/nav + section router
├── index.ts                # Re-export
└── sections/
    ├── <section>-view.tsx  # Individual section/page component
    ├── index.ts            # Barrel export of all sections
    └── shared.ts           # Shared helpers/constants for this portal
```

Admin portal sections: dashboard, orders, trips, transportation, vehicles, drivers, warehouses, inventory, stocks, replacements, feedback, reports, customers, users, settings, tracking.

Warehouse portal sections: dashboard, orders, inventory, stocks, warehouses, replacements, live-tracking.

Driver portal sections: home, trips, history, profile.

Customer portal sections: home, cart, checkout, orders, track, feedback, profile.

## Backend — `backend/`

```
backend/
├── config/
│   ├── settings.py         # Django settings (SQLite toggle via DJANGO_USE_SQLITE)
│   ├── urls.py             # Root URL conf
│   └── wsgi.py / asgi.py
├── core/
│   ├── models.py           # All Django ORM models
│   ├── views_api.py        # All DRF/function-based API views
│   ├── views.py            # Non-API views (if any)
│   ├── auth.py             # JWT auth helpers, Google OAuth verification
│   ├── urls.py             # /api/* URL patterns
│   ├── admin.py            # Django admin registrations
│   ├── mail_backends.py    # Gmail SMTP + Brevo email backends
│   ├── db_router.py        # Multi-DB router
│   └── migrations/         # 60 migration files
├── media/uploads/          # Uploaded files (POD photos, damage photos, etc.)
├── manage.py
└── requirements.txt
```

## Mobile — `mobile/`

```
mobile/
├── customer-app/           # React Native (Expo) customer app
│   ├── src/
│   │   ├── components/
│   │   ├── config/
│   │   ├── services/
│   │   └── types/
│   └── App.tsx
└── driver-app/             # React Native (Expo) driver app
    └── (same structure)
```

## Database — `prisma/`

```
prisma/
├── schema.prisma           # PostgreSQL schema (Supabase)
├── seed.ts                 # Seed script
├── migrations/             # Prisma migration history
├── export-db.mjs           # DB export utility
└── create-upload-bucket.mjs # Supabase storage bucket setup
```

## Key Architectural Patterns

### 1. App Variant System
`NEXT_PUBLIC_APP_VARIANT` env var controls which portals are accessible. Enforced in both `middleware.ts` (server-side) and `src/lib/app-variant.ts` (client-side). Allows one codebase to deploy as 4 separate apps.

### 2. Auth Flow
- Staff: POST `/api/auth/login` → JWT in httpOnly cookie + sessionStorage (tab-scoped)
- Customer: POST `/api/auth/customer/login` or Google OAuth → same JWT pattern
- `client-auth.ts` monkey-patches `window.fetch` to inject `Authorization: Bearer <token>` on all `/api/*` requests from sessionStorage
- Middleware verifies JWT on every API request and enforces variant-role restrictions

### 3. Portal Routing
`src/app/page.tsx` is the single SPA entry point. After auth check, it renders the correct portal component based on `user.role` + `user.type`. No separate routes per portal — all portals live under `/`.

### 4. API Proxy
`next.config.ts` rewrites `/api/:path*` → `http://127.0.0.1:8000/api/:path*`. The frontend never calls Django directly; all API calls go through Next.js which proxies to Django. This means zero frontend code changes when switching between Next.js API routes and Django.

### 5. Data Fetching
TanStack React Query with `staleTime: 5 minutes`, `refetchOnWindowFocus: false`. Each portal section manages its own queries. No global state store — auth state lives in `AuthContext`, portal state in `PortalContext`.

### 6. File Uploads
Files uploaded to `/api/upload/*` endpoints, stored in `public/uploads/` (Next.js) or `backend/media/uploads/` (Django). Supabase Storage bucket used in production.
