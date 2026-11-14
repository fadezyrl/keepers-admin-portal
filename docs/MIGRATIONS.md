# Database migrations

## Policy

- Additive only against the live Supabase project
- No destructive drops of existing public data (project was empty at first apply)
- Each file is tracked in `public.schema_migrations`
- Runner: `npm run migrate` from `backend/`

## 001_initial_schema.sql

Creates:

- membership_levels, roles, permissions, role_permissions, user_roles
- member_profiles (FK → auth.users), vehicles, social_links, emergency_contacts
- notification_preferences, notifications
- trips, trip_registrations (unique trip+user), trip_attendance (unique trip+user)
- rating_criteria, trip_ratings, trip_rating_scores
- membership_upgrade_requests (blocks self-review via CHECK), membership_history
- trip_media, member_media, hero_slides, gallery_items
- sponsors, events, announcements, documents, app_settings, audit_logs
- Trigger `sync_completed_trips` on attendance
- RLS enabled on all public tables + selective authenticated SELECT policies
- Storage buckets: avatars, vehicles, trips, gallery, sponsors, documents

## 002_seed_defaults.sql

Seeds:

- Membership: Junior / Intermediate / Advanced
- Roles: member, pre_marshall, marshall, admin, super_admin
- Granular permissions + role_permissions map
- Rating criteria: Driving, Safety, Teamwork, Preparedness (editable)
- Documents: protocols, safety-briefing, brochure, terms, privacy
- App settings including `registration_requires_approval=true`

## 008_device_tokens_and_push.sql

Adds:

- `device_tokens` (FCM token registry per user/device)
- `notifications.idempotency_key` + `notifications.push_status`
- `notification_preferences.registrations` + `ratings`
- RLS SELECT policy `device_tokens_own`

## 010_vehicle_readiness.sql

Adds:

- `vehicle_readiness_requirements` catalog (stable `code`, editable `label`)
- `trip_registration_readiness_items` per-registration snapshots (`selected`, `label_snapshot`)
- Seeds 7 standard optional pre-trip vehicle checks (join allows 0–N selections)

## Verify

```bash
npm run inspect-db
```
