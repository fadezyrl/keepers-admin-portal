-- Drive categories: Desert / Camping / Mountain / Trips & Events
-- Additive. Backfills existing rows via keyword heuristics; ambiguous → Trips & Events.

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS category TEXT;

-- Safe historical mapping from trip_type / title / destination keywords.
UPDATE public.trips
SET category = CASE
  WHEN category IS NOT NULL THEN category
  WHEN lower(coalesce(trip_type, '') || ' ' || coalesce(title, '') || ' ' || coalesce(destination, ''))
    ~ '(desert|dune|rub.?al.?khali|liwa|empty quarter)' THEN 'Desert Drives'
  WHEN lower(coalesce(trip_type, '') || ' ' || coalesce(title, '') || ' ' || coalesce(destination, ''))
    ~ '(camp|camping|overnight|bivouac)' THEN 'Camping Drives'
  WHEN lower(coalesce(trip_type, '') || ' ' || coalesce(title, '') || ' ' || coalesce(destination, ''))
    ~ '(mountain|mountains|wadi|jebel|traverse|highland)' THEN 'Mountain Drives'
  ELSE 'Trips & Events'
END
WHERE category IS NULL;

ALTER TABLE public.trips
  ALTER COLUMN category SET DEFAULT 'Trips & Events';

UPDATE public.trips
SET category = 'Trips & Events'
WHERE category IS NULL;

ALTER TABLE public.trips
  ALTER COLUMN category SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trips_category_check'
  ) THEN
    ALTER TABLE public.trips
      ADD CONSTRAINT trips_category_check
      CHECK (category IN (
        'Desert Drives',
        'Camping Drives',
        'Mountain Drives',
        'Trips & Events'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_trips_category ON public.trips(category);

INSERT INTO public.schema_migrations (id, notes)
VALUES ('011_trip_categories', 'Drive categories for discovery filtering')
ON CONFLICT (id) DO NOTHING;
