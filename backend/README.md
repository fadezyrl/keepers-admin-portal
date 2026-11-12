# Keepers Adventures API

Express backend for the Keepers Adventures mobile app and admin portal.

## Quick start

```bash
npm install
cp .env.example .env   # then fill values
npm run migrate
npm run seed:admin -- --email admin@keepers.ae --password '***' --username admin
npm run dev
```

See `../docs/SETUP.md` and `../docs/API.md`.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Nodemon server |
| `npm start` | Production server |
| `npm run migrate` | Apply SQL migrations |
| `npm run inspect-db` | Non-destructive schema inspection |
| `npm run seed:admin` | Create Super Admin via Supabase Auth |

## Layout

```
src/
  config/       env, db pool, supabase clients
  middleware/   auth, RBAC, errors
  routes/       HTTP routes
  services/     business logic
  validators/   Zod schemas
  utils/        responses, AppError
migrations/     versioned SQL
scripts/        migrate, inspect, seed-admin
```
