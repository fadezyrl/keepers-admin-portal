-- Admin-managed Pre-Marshall drive assignments + rating correction history

CREATE TABLE IF NOT EXISTS public.trip_pre_marshall_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (trip_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_pre_marshall_trip
  ON public.trip_pre_marshall_assignments (trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_pre_marshall_user
  ON public.trip_pre_marshall_assignments (user_id);

DROP TRIGGER IF EXISTS trg_trip_pre_marshall_assignments_updated_at
  ON public.trip_pre_marshall_assignments;
CREATE TRIGGER trg_trip_pre_marshall_assignments_updated_at
  BEFORE UPDATE ON public.trip_pre_marshall_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.trip_rating_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rating_id UUID NOT NULL REFERENCES public.trip_ratings(id) ON DELETE CASCADE,
  changed_by UUID NOT NULL REFERENCES auth.users(id),
  previous_overall_score NUMERIC(4,2),
  new_overall_score NUMERIC(4,2),
  previous_scores JSONB NOT NULL DEFAULT '[]'::jsonb,
  new_scores JSONB NOT NULL DEFAULT '[]'::jsonb,
  previous_private_feedback TEXT,
  new_private_feedback TEXT,
  previous_public_notes TEXT,
  new_public_notes TEXT,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trip_rating_history_rating
  ON public.trip_rating_history (rating_id, created_at DESC);

INSERT INTO public.schema_migrations (id, notes)
VALUES (
  '005_pre_marshall_assignments',
  'Pre-Marshall trip assignments and admin rating correction history'
)
ON CONFLICT (id) DO NOTHING;
