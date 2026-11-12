# Keepers Adventures Platform — Setup

## Architecture

- **Mobile:** `D:\keepers` (React Native) → Express API
- **Admin:** `D:\keepers-admin-portal\frontend` (Next.js) → Express API
- **API:** `D:\keepers-admin-portal\backend` (Express)
- **DB/Auth/Storage:** Supabase (PostgreSQL + Auth + Storage)

Never put `SUPABASE_SERVICE_ROLE_KEY` in the mobile app or Next.js `NEXT_PUBLIC_*` variables.

## 1. Database

Migrations are additive and documented under `backend/migrations/`.

```bash
cd D:\keepers-admin-portal\backend
npm install
# Ensure .env has database_url or DATABASE_URL
npm run migrate
npm run inspect-db
```

Applied:

| ID | Purpose |
|----|---------|
| `001_initial_schema` | Full relational schema, RLS enabled, storage buckets |
| `002_seed_defaults` | Roles, permissions, membership levels, rating criteria, documents, settings |

## 2. Backend environment

Copy `backend/.env.example` → `backend/.env` and set:

- `database_url` / `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server only)
- `PORT=4000`
- `CORS_ORIGINS=http://localhost:3000`

```bash
npm run dev
# Health: GET http://localhost:4000/api/health
```

## 3. Seed Super Admin

Requires Supabase Auth keys:

```bash
npm run seed:admin -- --email admin@keepers.ae --password 'YOUR_SECURE_PASSWORD' --username admin --first Admin --last Keepers
```

## 4. Admin Portal

```bash
cd D:\keepers-admin-portal\frontend
npm install
# .env.local: NEXT_PUBLIC_API_URL=http://localhost:4000/api
npm run dev
```

Open http://localhost:3000 — sign in with an approved admin account.

## 5. Mobile App

```bash
cd D:\keepers
npm install
npm start
npm run android   # or ios
```

API base URL: `src/config/api.ts` (`10.0.2.2:4000` on Android emulator, `127.0.0.1:4000` on iOS simulator).

## Business rules (implemented)

- New signups are `pending` until Admin approves
- Joining a trip does **not** increment `completed_trips`
- Only attendance (`trip_attendance.attended = true`) increments completed trips (DB trigger)
- Marshall upgrade recommendations stay pending until Admin reviews
- Marshall cannot approve their own upgrade recommendation
- Rating criteria (Driving, Safety, Teamwork, Preparedness) are DB-configurable 1–5 scores

## Soft blocker

Until `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are set, Auth/Storage endpoints return `AUTH_NOT_CONFIGURED` / `STORAGE_NOT_CONFIGURED`. Schema and health checks already work with the database URL alone.
