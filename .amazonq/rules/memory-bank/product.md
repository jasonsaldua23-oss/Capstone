# LogiTrack Pro — Product Overview

## Purpose & Value Proposition

LogiTrack Pro is a full-stack Logistics Management System built for a beverage trading company (Ann Ann's Beverages Trading). It manages the complete order-to-delivery lifecycle: order creation, warehouse preparation, driver dispatch, real-time GPS tracking, proof-of-delivery, replacements, and customer feedback — all in one platform.

## Target Users

| Role | Portal | Primary Tasks |
|------|--------|---------------|
| Super Admin / Admin | Admin Portal (web) | Orders, trips, drivers, vehicles, inventory, reports, user management |
| Warehouse Staff | Warehouse Portal (web) | Inventory, stock batches, order preparation, replacements |
| Delivery Driver | Driver Portal (mobile-first web + Android APK) | View trips, update stop status, upload proof of delivery, share live location |
| Customer | Customer Portal (web + React Native app) | Browse products, place orders, track deliveries, submit feedback |

## Key Features

### Order Management
- Full order lifecycle: PENDING → CONFIRMED → PREPARING → RESCHEDULED → OUT_FOR_DELIVERY → DELIVERED / CANCELLED
- Order items with product snapshots (price/name preserved at order time)
- Discount policies per customer
- Payment methods: COD, GCash, Maya, bank transfer

### Transportation & Dispatch
- Trip planning with ordered drop points (PICKUP / DELIVERY / RETURN)
- Driver–vehicle assignment
- Real-time GPS location logging (LocationLog)
- Proof of delivery: recipient name, photo upload, failure reason

### Warehouse & Inventory
- Multi-warehouse support with stock batches (FIFO-ready)
- Inventory transactions (IN / OUT / TRANSFER / ADJUSTMENT / RETURN)
- Low-stock threshold alerts
- Loose-bottle tracking alongside case/pack units

### Replacements (Reverse Logistics)
- Damage/replacement requests initiated by customer or driver
- Status workflow: REPORTED → IN_PROGRESS → RESOLVED_ON_DELIVERY / NEEDS_FOLLOW_UP → COMPLETED
- Damage photo upload, refund tracking

### Customer Portal
- Product catalog with cart and checkout
- Order tracking with delivery timeline
- Feedback (COMPLIMENT / COMPLAINT / SUGGESTION / QUESTION) with 1–5 star rating
- Google OAuth login + email OTP verification

### Maps & Tracking
- Leaflet + OpenStreetMap for live tracking map
- GeoJSON boundaries for Negros Occidental region
- OSRM-ready route optimization
- Browser Geolocation API for driver location sharing

### Notifications & Audit
- In-app notifications for staff and customers
- AuditLog for entity changes

## App Variants

The single Next.js codebase is deployed as multiple focused apps via `NEXT_PUBLIC_APP_VARIANT`:

| Variant | Portals Shown | Dev Command |
|---------|--------------|-------------|
| `all` | All four portals | `npm run dev` |
| `admin` | Admin + Warehouse | `npm run dev:admin` |
| `warehouse` | Warehouse only | `npm run dev:warehouse` |
| `driver` | Driver only | `npm run dev:driver` |
| `customer` | Customer only | `npm run dev:customer` |

Android APK builds (Capacitor) exist for driver and customer variants.

## Deployment

- **Frontend**: Next.js standalone output, deployable to Vercel or any Node host
- **Backend**: Django REST API (Python) on port 8000; Next.js rewrites all `/api/*` to Django
- **Database**: PostgreSQL via Supabase (production); SQLite available for Django local dev
- **File Storage**: Supabase Storage bucket for product images, POD photos, customer avatars
- **CI/CD**: GitHub Actions workflow (`.github/workflows/deploy.yml`)
