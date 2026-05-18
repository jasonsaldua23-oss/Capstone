# LogiTrack Pro — Development Guidelines

## Django Backend Patterns

### API View Structure
All API views are plain Django function-based views (no class-based views, no DRF ViewSets). Every view follows this exact pattern:

```python
@csrf_exempt
@require_http_methods(["GET", "POST"])
def resource_collection(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)  # or _require_staff(request)
    if not p:
        return _err("Unauthorized", 401)
    # ... handler logic
```

- `@csrf_exempt` on all mutating endpoints
- `@require_GET` for read-only endpoints
- `@require_http_methods([...])` for mixed-method endpoints
- Always return `JsonResponse` via `_ok()` or `_err()` helpers

### Response Helpers
Always use these — never construct `JsonResponse` directly:

```python
def _ok(data: dict[str, Any], status: int = 200) -> JsonResponse: ...
def _err(message: str, status: int = 400) -> JsonResponse: ...
# _err always returns: {"success": False, "error": message}
# _ok wraps data as-is with the given status
```

### Auth Guards
Three levels, used consistently:

```python
p = _require_auth(request)          # any authenticated user (staff or customer)
staff, err = _require_staff(request) # staff only; returns (payload, None) or (None, err_response)
# For driver-only: check p.get("role") == "DRIVER" after _require_staff
```

### Serialization
Use `_serialize_model(obj, exclude={"password"})` to convert Django model instances to camelCase dicts. The `_camel()` helper converts `snake_case` field names automatically. Never manually build serialization dicts for model fields.

For nested relations, use the `include` parameter:
```python
_serialize_model(item, include={
    "warehouse": lambda o: _serialize_model(o.warehouse),
    "product": lambda o: _serialize_model(o.product),
})
```

### Pagination
Always use `_pagination(request)` for list endpoints:
```python
page, size, off = _pagination(request)
# page: 1-based, size: clamped 1–1000, off: SQL offset
qs = qs[off : off + size]
return _ok({"success": True, "items": [...], "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})
```

### Input Parsing
```python
body = _json_body(request)          # safe JSON parse, returns {} on failure
qty = _int(body.get("quantity"), 0) # safe int cast with default
lat = _to_float_or_none(value)      # returns None for NaN/Inf/non-numeric
dt = _parse_iso_datetime(value)     # handles "Z" suffix, makes timezone-aware
```

### Status Normalization
Always normalize status strings before comparing or saving:
```python
status = _normalize_order_status(raw_value)   # handles legacy aliases
status = _normalize_replacement_status(raw, mode)
```

### Database Transactions
Wrap multi-step writes in `transaction.atomic()`:
```python
with transaction.atomic():
    order = Order.objects.create(...)
    for item in items:
        OrderItem.objects.create(order=order, ...)
```

### Notifications
Use `_create_staff_notifications()` after every significant mutation:
```python
_create_staff_notifications(
    title="Order created",
    message=f"{actor_name} created order {order.order_number}.",
    notification_type="ORDER",
    reference_type="order",
    reference_id=order.id,
)
```

### Email
Use `_send_transactional_email()` for all outbound email. It tries Brevo first, falls back to SMTP:
```python
_send_transactional_email(subject=..., message=..., recipients=[email])
```

### Sample Data Filtering
All list queries pass through `_real_*()` helpers to exclude seeded demo data when `_hide_sample_data()` is True:
```python
qs = _real_orders(Order.objects.all())
qs = _real_customers(Customer.objects.all())
```

### Inventory Allocation
FEFO (First Expired, First Out) is the default policy. Use `_sorted_batches_for_policy(batches, policy)` to sort batches before allocating. Always create an `InventoryTransaction` record for every stock movement.

---

## Django Test Patterns

### Test Class Structure
Each test class covers one API contract area. Class names follow `<Domain>ApiContractTests(TestCase)`:

```python
class NotificationsApiContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        # Create roles, users, tokens in setUp
        self.token = create_token({"userId": ..., "role": ..., "type": "staff"})

    def test_<behavior>_<expected_outcome>(self) -> None:
        response = self.client.get("/api/...", HTTP_AUTHORIZATION=f"Bearer {self.token}")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
```

### Token Creation in Tests
```python
from .auth import create_token
token = create_token({"userId": user.id, "email": user.email, "name": user.name, "role": "ADMIN", "type": "staff"})
```

### Role Simulation
The test file uses a local `Role` stub class (not a real model) since roles are stored as string values on `User.role`. Use `Role.objects.create(name="ADMIN")` which returns a `_RoleValue` string object.

### Driver Stub
Use the local `Driver.objects.create(user=user, ...)` stub which sets driver fields directly on the `User` model (since Driver was merged into User).

### Test Naming Convention
`test_<resource>_<action>_<condition>_<expected_result>` — descriptive, no abbreviations.

### Assertion Pattern
Always check both HTTP status and `payload["success"]` / `payload["error"]`:
```python
self.assertEqual(response.status_code, 400)
self.assertFalse(payload["success"])
self.assertEqual(payload["error"], "exact error message")
```

---

## Next.js / React Frontend Patterns

### Component File Headers
All portal components and hooks use `'use client'` directive at the top.

### Fetch Pattern
Use `safeFetchJson()` (defined in WarehousePortal) for resilient data fetching with retries and timeout:
```typescript
const result = await safeFetchJson('/api/resource', { cache: 'no-store' })
if (!result.ok) return
const list = getCollection<ItemType>(result.data, ['items'])
```

`getCollection<T>(payload, keys)` safely extracts arrays from API responses regardless of key name.

### State Management
- No global state store (no Zustand/Redux)
- Auth state: `AuthContext` from `src/app/page.tsx` — use `useAuth()`
- Portal state: `PortalContext` — use `usePortal()`
- All other state is local `useState` within portal components
- TanStack React Query for server state with `staleTime: 5 * 60 * 1000`

### Toast Notifications
Use `sonner` (not the shadcn toast):
```typescript
import { toast } from 'sonner'
toast.success('Action completed')
toast.error(error?.message || 'Something went wrong')
```

### API Calls Pattern
```typescript
const response = await fetch('/api/resource', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})
const data = await response.json().catch(() => ({}))
if (!response.ok || data?.success === false) {
  throw new Error(data?.error || 'Failed')
}
```

### Data Sync
Use `emitDataSync(['orders', 'trips'])` after mutations to notify other portal sections to refresh:
```typescript
import { emitDataSync, subscribeDataSync } from '@/lib/data-sync'
emitDataSync(['inventory', 'products'])
```

### Polling / Auto-refresh
Portals use `setInterval` + `visibilitychange` + `focus` events for auto-refresh. Live tracking refreshes every 7 seconds; general data refreshes every 30 seconds.

### Dynamic Imports for Maps
Leaflet must be loaded client-side only:
```typescript
const LiveTrackingMap = dynamic(() => import('@/components/shared/LiveTrackingMap'), { ssr: false })
```

### TypeScript Conventions
- All local interfaces defined at the top of the file (not in `types/index.ts` unless shared)
- Use `as any` sparingly for Leaflet/Capacitor interop
- Prefer `String(value || '').trim()` over optional chaining for API response fields
- `Number.isFinite()` for coordinate validation, never `isNaN()`

### Tailwind CSS
- Use Tailwind utility classes directly — no CSS modules
- Glassmorphism pattern used in warehouse portal: `bg-white/38 backdrop-blur-2xl border-white/25`
- Status colors follow a consistent palette: blue=in-progress, green=completed, red=failed/cancelled, amber=warning

### shadcn/ui Usage
Import from `@/components/ui/*`. Always use the component's own props — do not override with raw HTML attributes unless necessary.

### Password Validation
Use `validatePasswordPolicy()` from `@/lib/password-policy` on the frontend. The same rules are enforced by `_validate_password_strength()` on the backend.

### Image Uploads
Upload via `POST /api/uploads/product-image` (multipart form). Response: `{ success: true, imageUrl: "/uploads/products/..." }`.

---

## Leaflet / Map Patterns

### Map Component Architecture
`LiveTrackingMap` is a self-contained component that:
1. Loads GeoJSON boundaries lazily (cached in module-level variables)
2. Snaps route lines to roads via OSRM API
3. Smoothly animates truck markers using `requestAnimationFrame`
4. Restricts map bounds to Silay/Talisay service area when `restrictToNegrosOccidental=true`

### Marker Types
- `markerType: 'truck'` — animated truck icon with heading rotation
- `markerType: 'pin'` — colored pin with optional sequence number
- `markerType: 'dot'` — circle marker
- Default — standard Leaflet marker

### Coordinate Convention
All coordinates are `[lat, lng]` tuples (Leaflet convention). GeoJSON uses `[lng, lat]` — always convert when parsing GeoJSON.

### Boundary Masking
The map uses an "evenodd" fill polygon to mask areas outside the service boundary. The mask polygon is `[WORLD_MASK_RING, ...serviceRings]`.

---

## App Variant System

### Adding a New Portal
1. Add variant to `AppVariant` type in `src/lib/app-variant.ts`
2. Update `VARIANT_PORTAL_MAP` and `VARIANT_DEFAULT_PORTAL`
3. Add login route under `src/app/login/<portal>/page.tsx`
4. Add portal component and render it in `src/app/page.tsx`
5. Update `middleware.ts` `allowedPortalsForVariant()` and `isAllowedAuthRouteForVariant()`

### Environment-Based Builds
Use `NEXT_PUBLIC_APP_VARIANT` to build focused single-portal apps. The middleware enforces variant restrictions server-side; `app-variant.ts` enforces them client-side.

---

## Order & Inventory Lifecycle Rules

### Order Status Transitions (enforced server-side)
```
PENDING → CONFIRMED → PREPARING → OUT_FOR_DELIVERY → DELIVERED
                    ↘ CANCELLED (from any non-terminal state)
RESCHEDULED → PREPARING | OUT_FOR_DELIVERY | CANCELLED
```
`OUT_FOR_DELIVERY` is set automatically when a trip starts — never set manually.

### Warehouse Stage Transitions
```
READY_TO_LOAD → LOADED → DISPATCHED
```
- `LOADED` requires: driver assigned + checklist complete
- `DISPATCHED` is set automatically when trip starts

### Inventory Reservation Flow
1. Order created → `RESERVE` transaction per order item
2. Order loaded → spare products allocated from driver stock
3. Trip starts → order status → `OUT_FOR_DELIVERY`
4. Drop point completed → `RESERVE_CONSUMED` + `OUT` transactions
5. Drop point failed (no reschedule) → `UNRESERVE` transactions + order `CANCELLED`
6. Drop point failed (reschedule) → inventory stays reserved, order reset to `PREPARING`

### Spare Products Policy
- Case unit: 8–12% of ordered quantity (recommended 10%)
- Pack/bundle unit: 3–5% (recommended 4%)
- Minimum 1 spare when quantity > 0
- Auto-allocated on `LOADED` stage, auto-returned on delivery completion

---

## Security Patterns

### JWT
- Shared secret between Next.js middleware and Django backend (`JWT_SECRET` env var)
- Tokens stored in httpOnly cookie + sessionStorage (tab-scoped)
- `client-auth.ts` monkey-patches `window.fetch` to inject `Authorization: Bearer` header
- Token expiry: 24h default, 30 days with `rememberMe`

### Password Policy
Enforced on both frontend and backend:
- Minimum 8 characters
- Must include uppercase, lowercase, digit, special character
- No spaces allowed

### Email Restriction
Only Gmail addresses (`@gmail.com`) are allowed for staff and customer accounts. Enforced by `_is_gmail_email()` on backend.

### Address Restriction
Customer and warehouse addresses must be within Silay or Talisay, Negros Occidental. Enforced by `_ensure_negros_occidental_address()`.

### OTP Flow
Stateless HMAC-based OTP (no DB storage). Valid for 10 minutes. Used for:
- Email verification before account creation
- Password reset
- Profile/password changes in portal settings
