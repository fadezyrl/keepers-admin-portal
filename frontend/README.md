# Keepers Adventures Admin Portal

Next.js 16 (App Router) + Tailwind v4 + React 19 admin UI for Keepers Adventures.

## Setup

```bash
cd D:\keepers-admin-portal\frontend
cp .env.example .env.local
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The API must be running at `NEXT_PUBLIC_API_URL` (default `http://localhost:4000/api`).

Sign in with an approved admin / super_admin account. JWT is stored in `localStorage` as `keepers_admin_token`.

## Scripts

- `npm run dev` — development server
- `npm run build` — production build
- `npm run start` — serve production build
- `npm run lint` — ESLint

## Stack notes

- Auth is client-side (Bearer JWT). Admin routes redirect to `/login` when no token is present.
- Brand tokens live in `app/globals.css`.
- API wrapper: `lib/api.ts`. Auth context: `lib/auth.tsx`.
