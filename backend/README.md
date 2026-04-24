# Django Backend (Parallel Migration)

This backend is created in parallel to the existing Next.js API so the current system stays working while migration proceeds.

## Run

```powershell
cd backend
python manage.py makemigrations
python manage.py migrate
python manage.py shell -c "from core.views import ensure_demo_accounts; ensure_demo_accounts(); print('demo users ready')"
python manage.py runserver 0.0.0.0:8000
```

## API coverage in Django

- `GET /api/`
- `GET /api/health`
- `POST /api/auth/login`
- `POST /api/auth/customer/login`
- `POST /api/auth/register`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/roles`
- `GET|POST /api/users`
- `GET|PUT|DELETE /api/users/:id`
- `GET|POST /api/customers`
- `GET|PUT|DELETE /api/customers/:id`
- `GET /api/categories`
- `GET|POST /api/warehouses`
- `GET|PUT|DELETE /api/warehouses/:id`
- `GET|POST /api/products`
- `GET|PUT|DELETE /api/products/:id`
- `GET|POST /api/inventory`
- `PUT /api/inventory/:id`
- `GET /api/inventory-transactions`
- `GET|POST /api/stock-batches`
- `GET|POST|PATCH /api/vehicles`
- `DELETE /api/vehicles/:id`
- `GET|POST|PUT /api/drivers`
- `GET /api/dashboard/stats`
- `GET|POST|PATCH /api/feedback`
- `GET|PATCH /api/notifications`
- `GET|POST|PATCH /api/orders`
- `GET /api/orders/:id`
- `PATCH /api/orders/:id/status`
- `GET|POST /api/trips`
- `GET /api/driver/trips`
- `GET|POST /api/customer/orders`
- `PATCH /api/customer/orders/:id/cancel`
- `GET /api/customer/replacements`
- `GET /api/customer/tracking`
- `POST /api/driver/location`
- `GET|PUT /api/driver/profile`
- `GET|POST /api/driver/spare-products`
- `POST /api/driver/replacements/from-spare-products`
- `GET|POST /api/trips/route-plan`
- `POST /api/trips/:id/start`
- `PATCH /api/trips/:id/drop-points/:dropPointId`
- `PATCH /api/trips/:id/stops/:stopId`
- `POST /api/uploads/product-image`
- `POST /api/uploads/pod-image`
- `POST /api/uploads/customer-avatar`

## Notes

- Uses `.env` from repo root (`DATABASE_URL`, `JWT_SECRET`) when present.
- Domain models are ported from Prisma schema in `prisma/schema.prisma`.
- Existing Next.js API remains untouched for safe migration.
- Use Django on a different port during parallel validation, then switch traffic when ready.
