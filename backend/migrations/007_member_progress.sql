-- ============================================================================
-- Keepers Adventures 4x4 — Migration 007: Member progress thresholds + completed-trip rules
-- ============================================================================

-- Admin-configurable eligibility fields on membership levels (0 / NULL = no quantitative gate)
ALTER TABLE public.membership_levels
  ADD COLUMN IF NOT EXISTS min_completed_trips INT NOT NULL DEFAULT 0
    CHECK (min_completed_trips >= 0);

ALTER TABLE public.membership_levels
  ADD COLUMN IF NOT EXISTS min_average_rating NUMERIC(3,2)
    CHECK (min_average_rating IS NULL OR (min_average_rating >= 1 AND min_average_rating <= 5));

COMMENT ON COLUMN public.membership_levels.min_completed_trips IS
  'Minimum completed (attended + trip completed) drives required before eligibility for this level. 0 = no trip-count gate.';
COMMENT ON COLUMN public.membership_levels.min_average_rating IS
  'Optional minimum overall average rating for eligibility. NULL = no rating gate.';

-- completed_trips = attended on drives that are actually completed
CREATE OR REPLACE FUNCTION public.sync_completed_trips()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_user UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_user := OLD.user_id;
  ELSE
    target_user := NEW.user_id;
  END IF;

  UPDATE public.member_profiles mp
  SET completed_trips = (
    SELECT COUNT(*)::INT
    FROM public.trip_attendance ta
    JOIN public.trips t ON t.id = ta.trip_id
    WHERE ta.user_id = target_user
      AND ta.attended = TRUE
      AND t.status = 'completed'
      AND t.deleted_at IS NULL
  ),
  updated_at = NOW()
  WHERE mp.id = target_user;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_completed_trips ON public.trip_attendance;
CREATE TRIGGER trg_sync_completed_trips
AFTER INSERT OR UPDATE OR DELETE ON public.trip_attendance
FOR EACH ROW EXECUTE FUNCTION public.sync_completed_trips();

-- When a drive is marked completed/cancelled, refresh every attendee's completed_trips
CREATE OR REPLACE FUNCTION public.resync_completed_trips_on_trip_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at) THEN
    UPDATE public.member_profiles mp
    SET completed_trips = (
      SELECT COUNT(*)::INT
      FROM public.trip_attendance ta
      JOIN public.trips t ON t.id = ta.trip_id
      WHERE ta.user_id = mp.id
        AND ta.attended = TRUE
        AND t.status = 'completed'
        AND t.deleted_at IS NULL
    ),
    updated_at = NOW()
    WHERE mp.id IN (
      SELECT ta.user_id FROM public.trip_attendance ta WHERE ta.trip_id = NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_resync_completed_trips_on_trip_status ON public.trips;
CREATE TRIGGER trg_resync_completed_trips_on_trip_status
AFTER UPDATE OF status, deleted_at ON public.trips
FOR EACH ROW EXECUTE FUNCTION public.resync_completed_trips_on_trip_status();

-- One-time backfill under the new rule
UPDATE public.member_profiles mp
SET completed_trips = (
  SELECT COUNT(*)::INT
  FROM public.trip_attendance ta
  JOIN public.trips t ON t.id = ta.trip_id
  WHERE ta.user_id = mp.id
    AND ta.attended = TRUE
    AND t.status = 'completed'
    AND t.deleted_at IS NULL
),
updated_at = NOW();

INSERT INTO public.schema_migrations (id, notes)
VALUES (
  '007_member_progress',
  'Membership level eligibility columns + completed_trips only for completed drives'
)
ON CONFLICT (id) DO NOTHING;
