# Manual Steps: Supabase + Vercel Deployment

## What is already done in code

- Prisma datasource switched to PostgreSQL with `DIRECT_URL`
- `.env.example` prepared for Supabase
- Vercel build command configured (`vercel.json`)
- `vercel-build` script added to run:
  - `prisma generate`
  - `prisma migrate deploy`
  - `next build`

## 1) Supabase (Dashboard)

1. Create a new Supabase project.
2. Open `Connect` in the project dashboard.
3. Copy two connection strings:
   - Transaction pooler (`6543`) -> use for `DATABASE_URL`
   - Session/direct (`5432`) -> use for `DIRECT_URL`
4. Create or confirm a public Storage bucket for uploads.
   - Recommended bucket name: `uploads`

## 2) Local environment (your machine)

1. Copy `.env.example` to `.env` if needed.
2. Fill these values in `.env`:
   - `DATABASE_URL`
   - `DIRECT_URL`
   - `JWT_SECRET`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_UPLOADS_BUCKET`
   - `NEXT_PUBLIC_APP_VARIANT`
3. Run:
   - `npm run db:generate`
   - `npx prisma migrate dev --name init_postgres`

## 3) Push repo

1. Commit current changes.
2. Push to GitHub/GitLab/Bitbucket.

## 4) Vercel (Admin deployment)

1. Import your repository as a new Vercel project.
2. In project settings, add Environment Variables:
   - `DATABASE_URL` = Supabase transaction URL (`6543`)
   - `DIRECT_URL` = Supabase direct/session URL (`5432`)
   - `JWT_SECRET` = same secret used locally
   - `SUPABASE_URL` = Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = service role key from Supabase
   - `SUPABASE_UPLOADS_BUCKET` = uploads bucket name
   - `NEXT_PUBLIC_APP_VARIANT` = `admin`
3. Deploy.

## 5) Vercel (Driver deployment)

1. Create another Vercel project from same repo.
2. Use same DB + JWT vars.
3. Set `NEXT_PUBLIC_APP_VARIANT=driver`.
4. Deploy.

## 6) Vercel (Customer deployment)

1. Create another Vercel project from same repo.
2. Use same DB + JWT vars.
3. Set `NEXT_PUBLIC_APP_VARIANT=customer`.
4. Deploy.

## 7) Mobile app URLs

Set mobile app server URLs to their deployment:

- Driver app URL ends with `/login/driver`
- Customer app URL ends with `/login/customer`

Examples:

- `https://driver.your-domain.com/login/driver`
- `https://customer.your-domain.com/login/customer`

## 8) Android build commands

Driver:

```powershell
set APP_VARIANT=driver&& set CAP_SERVER_URL=https://driver.your-domain.com/login/driver&& npm run cap:sync:android:driver
```

Customer:

```powershell
set APP_VARIANT=customer&& set CAP_SERVER_URL=https://customer.your-domain.com/login/customer&& npm run cap:sync:android:customer
```
