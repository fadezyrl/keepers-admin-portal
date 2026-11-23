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
| `npm test` | Unit tests (device tokens + notifications) |

FCM setup: see `../docs/FIREBASE_PUSH.md`.

## Trip chat (Socket.IO + presence)

- REST under `/api/chat/*`; Socket.IO on the same HTTP server (`/socket.io`).
- Messages: `GET /conversations/:id/messages?before=` (older page) or `?after=` (newer catch-up for local-first clients). Do not combine both.
- `listMessages` batch-loads attachments, senders, and receipts (no per-row N+1).
- Private conversations use `conversations.private_member_id` with `UNIQUE (trip_id, private_member_id)`.
- Every socket/REST send, join, receipt, and media action re-checks conversation ACL. Cancel/reject registration revokes rooms immediately.
- Delivered/read receipts update only from device ACKs — not from Socket emit or FCM send.
- Idempotent sends via `client_message_id` + unique index.
- **Presence / FCM suppress:** set `REDIS_URL` for multi-instance. Without it, presence is in-memory and **single-instance only** (documented in `.env.example` and boot logs).

## Layout

```
src/
  config/       env, db pool, supabase clients
  middleware/   auth, RBAC, errors
  routes/       HTTP routes
  realtime/     Socket.IO chat gateway
  services/     business logic (+ presenceStore)
  validators/   Zod schemas
  utils/        responses, AppError
migrations/     versioned SQL
scripts/        migrate, inspect, seed-admin
```
