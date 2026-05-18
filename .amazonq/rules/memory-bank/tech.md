# LogiTrack Pro — Technology Stack

## Frontend

| Technology | Version | Purpose |
|-----------|---------|---------|
| Next.js | ^16.1.1 | App framework, API proxy, standalone build |
| React | ^19.0.0 | UI library |
| TypeScript | ^5 | Type safety |
| Tailwind CSS | ^4 | Utility-first styling |
| shadcn/ui (Radix UI) | latest | Accessible UI primitives |
| TanStack React Query | ^5.82.0 | Server state, caching, data fetching |
| Recharts | ^2.15.4 | Charts and analytics |
| Leaflet + react-leaflet | ^1.9.4 / ^5.0.0 | Interactive maps |
| Framer Motion | ^12.23.2 | Animations |
| Lucide React | ^0.525.0 | Icons |
| Sonner | ^2.0.6 | Toast notifications |
| jose | ^6.2.0 | JWT verification (edge-compatible) |
| socket.io-client | ^4.8.3 | Real-time updates (ready) |
| pdf-lib | ^1.17.1 | PDF generation |
| tesseract.js | ^7.0.0 | OCR (receipt scanning) |
| Capacitor | ^7.1.0 | Android APK wrapper |

## Backend (Django)

| Technology | Version | Purpose |
|-----------|---------|---------|
| Django | >=4.2,<5.0 | Web framework |
| Django REST Framework | >=3.15 | API views |
| django-cors-headers | >=4.4 | CORS for Next.js dev proxy |
| psycopg (binary) | >=3.1 | PostgreSQL driver |
| PyJWT | >=2.8 | JWT creation/verification |
| google-auth | >=2.35 | Google OAuth token verification |
| gunicorn | >=22.0 | Production WSGI server |
| python-dotenv | >=1.0 | .env loading |

## Mobile (React Native)

| Technology | Purpose |
|-----------|---------|
| React Native (Expo) | Customer app + Driver app |
| Capacitor Android | Native Android wrapper for web portals |

## Database & Storage

| Service | Purpose |
|---------|---------|
| PostgreSQL (Supabase) | Production database |
| SQLite | Django local dev (`DJANGO_USE_SQLITE=1`) |
| Prisma ORM | Schema management, migrations, type-safe client |
| Supabase Storage | File uploads (product images, POD photos, avatars) |

## Infrastructure & Services

| Service | Purpose |
|---------|---------|
| Supabase | PostgreSQL + Storage |
| Vercel | Frontend deployment (vercel.json present) |
| Render | Alternative deployment (render.yaml present) |
| GitHub Actions | CI/CD (`.github/workflows/deploy.yml`) |
| Caddy | Reverse proxy (Caddyfile present) |
| Gmail SMTP | OTP / transactional email |
| Brevo | Alternative email provider |
| Google OAuth | Customer + staff SSO |
| PayMongo | Payment gateway (GCash, Maya, card — optional) |
| OpenStreetMap / OSRM | Map tiles + route optimization |

## Environment Variables

```bash
# Database
DATABASE_URL=postgresql://...          # Supabase pooler URL (Prisma)
DIRECT_URL=postgresql://...            # Supabase direct URL (Prisma migrations)

# Django
DJANGO_USE_SQLITE=1                    # Use SQLite for Django local dev
DJANGO_API_ORIGIN=http://127.0.0.1:8000  # Django origin for Next.js rewrite

# Auth
JWT_SECRET=<base64-secret>             # Shared JWT secret (Next.js + Django)

# Supabase
SUPABASE_URL=https://...supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...

# Google OAuth
NEXT_PUBLIC_GOOGLE_CLIENT_ID=...       # Browser-side client ID
GOOGLE_OAUTH_CLIENT_ID=...             # Server-side (same value)
GOOGLE_OAUTH_CLIENT_SECRET=...

# Email
OTP_GMAIL_USER=...
OTP_GMAIL_APP_PASSWORD=...
OTP_FROM_NAME=Ann Ann's Beverages Trading
OTP_FROM_EMAIL=...
BREVO_API_KEY=...

# App Variant (optional)
NEXT_PUBLIC_APP_VARIANT=all            # all | admin | warehouse | driver | customer
```

## Development Commands

### Next.js Frontend

```bash
# Install dependencies
bun install

# Dev server (all portals)
npm run dev                    # port 3000, all portals

# Dev server (specific portal)
npm run dev:admin              # Admin + Warehouse portals
npm run dev:warehouse          # Warehouse portal only
npm run dev:driver             # Driver portal only
npm run dev:customer           # Customer portal only

# Dev with HTTPS (for mobile/LAN testing)
npm run dev:https              # Self-signed cert
npm run dev:https:lan          # Custom LAN cert

# Build
npm run build                  # Full build
npm run build:admin            # Admin variant build
npm run build:customer         # Customer variant build

# Database (Prisma)
npm run db:push                # Push schema changes (no migration)
npm run db:generate            # Regenerate Prisma client
npm run db:migrate             # Create + apply migration
npm run db:migrate:deploy      # Apply migrations (production)
npm run db:reset               # Reset database
npm run db:export              # Export DB to JSON

# Capacitor (Android)
npm run cap:sync:android       # Sync web assets to Android
npm run cap:run:android        # Run on Android device/emulator
npm run cap:open:android       # Open in Android Studio
```

### Django Backend

```bash
cd backend

# Local dev with SQLite
set DJANGO_USE_SQLITE=1
python manage.py migrate
python manage.py runserver 0.0.0.0:8000

# Production with PostgreSQL
set DJANGO_USE_SQLITE=0
python manage.py migrate
gunicorn config.wsgi:application --bind 0.0.0.0:8000
```

## TypeScript Configuration

- `tsconfig.json`: strict mode off, path alias `@/*` → `./src/*`
- `next.config.ts`: `typescript.ignoreBuildErrors: true` (build never fails on type errors)
- `reactStrictMode: false` (avoids double-render issues with Leaflet/Capacitor)

## Linting

```bash
npm run lint    # ESLint with eslint-config-next
```

Config: `eslint.config.mjs` — Next.js recommended rules.
