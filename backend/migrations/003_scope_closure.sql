-- Scope closure: pending trip registrations, event draft status, events.manage

ALTER TABLE public.trip_registrations
  DROP CONSTRAINT IF EXISTS trip_registrations_status_check;

ALTER TABLE public.trip_registrations
  ADD CONSTRAINT trip_registrations_status_check
  CHECK (status IN ('registered', 'waitlist', 'cancelled', 'rejected', 'pending'));

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_status_check;

ALTER TABLE public.events
  ADD CONSTRAINT events_status_check
  CHECK (status IN ('draft', 'scheduled', 'cancelled', 'completed'));

INSERT INTO public.permissions (code, name, description) VALUES
  ('events.manage', 'Manage events', 'Create and manage club events')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.code IN ('admin', 'super_admin')
  AND p.code = 'events.manage'
ON CONFLICT DO NOTHING;
