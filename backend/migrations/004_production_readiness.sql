-- Production readiness: Pre-Marshall restrictions, capacity settings, indexes

-- Pre-Marshall must not mark attendance without organizer/admin authority.
-- Official attendance marking remains on marshall/admin via attendance.mark + trip ownership checks.
DELETE FROM public.role_permissions rp
USING public.roles r, public.permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.code = 'pre_marshall'
  AND p.code = 'attendance.mark';

INSERT INTO public.app_settings (key, value, description) VALUES
  (
    'trip_join_allow_waitlist',
    'false'::jsonb,
    'When true, joins beyond capacity become waitlist; when false, reject with TRIP_FULL'
  )
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_trip_registrations_trip_active
  ON public.trip_registrations (trip_id)
  WHERE status IN ('registered', 'pending');

INSERT INTO public.schema_migrations (id, notes)
VALUES ('004_production_readiness', 'Pre-Marshall attendance revoke, waitlist setting, capacity index')
ON CONFLICT (id) DO NOTHING;
