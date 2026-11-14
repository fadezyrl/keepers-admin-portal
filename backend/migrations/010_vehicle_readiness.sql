-- Pre-trip vehicle readiness checklist (optional at join).
-- Stable requirement codes; labels snapshotted per registration for history.

CREATE TABLE IF NOT EXISTS public.vehicle_readiness_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.trip_registration_readiness_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id UUID NOT NULL REFERENCES public.trip_registrations(id) ON DELETE CASCADE,
  requirement_id UUID NOT NULL REFERENCES public.vehicle_readiness_requirements(id) ON DELETE RESTRICT,
  requirement_code TEXT NOT NULL,
  label_snapshot TEXT NOT NULL,
  selected BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (registration_id, requirement_id)
);

CREATE INDEX IF NOT EXISTS idx_readiness_items_registration
  ON public.trip_registration_readiness_items(registration_id);

INSERT INTO public.vehicle_readiness_requirements (code, label, display_order) VALUES
  ('4x4_functioning', '4x4 is functioning', 1),
  ('fluids_optimum', 'All car fluids are at optimum level', 2),
  ('seat_belts_functional', 'Seat belts are functional', 3),
  ('air_filter_cleaned', 'Cleaned air filter', 4),
  ('fuelled_full', 'Car is fuelled (tank is full)', 5),
  ('drinking_water', 'Drinking water', 6),
  ('offroad_insurance', 'Off-road car insurance', 7)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  display_order = EXCLUDED.display_order,
  is_active = TRUE,
  updated_at = NOW();

INSERT INTO public.schema_migrations (id, notes)
VALUES (
  '010_vehicle_readiness',
  'Vehicle readiness requirement catalog + per-registration checklist snapshots'
)
ON CONFLICT (id) DO NOTHING;
