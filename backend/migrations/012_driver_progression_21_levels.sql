-- ============================================================================
-- Keepers Adventures 4x4 — Migration 012: Driver progression (21 levels)
-- Extends existing membership_levels / upgrade / history. Does not alter RBAC roles.
-- Mapping (confirmed): junior→Junior 1, intermediate→Intermediate 1, advanced→Advanced 1
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extend membership_levels schema
-- ---------------------------------------------------------------------------
ALTER TABLE public.membership_levels
  ADD COLUMN IF NOT EXISTS rank_group TEXT,
  ADD COLUMN IF NOT EXISTS level_number INT,
  ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Temporarily relax unique rank so we can re-order in place
ALTER TABLE public.membership_levels DROP CONSTRAINT IF EXISTS membership_levels_rank_key;

-- Remap existing 3 levels in place (preserve UUIDs → member_profiles / trips FKs stay valid)
UPDATE public.membership_levels
SET
  code = 'junior_1',
  name = 'Junior 1',
  display_name = 'Junior 1',
  rank_group = 'junior',
  level_number = 1,
  rank = 1,
  description = COALESCE(description, 'Entry driving level — Junior rank, stage 1'),
  updated_at = NOW()
WHERE code = 'junior';

UPDATE public.membership_levels
SET
  code = 'intermediate_1',
  name = 'Intermediate 1',
  display_name = 'Intermediate 1',
  rank_group = 'intermediate',
  level_number = 1,
  rank = 4,
  description = COALESCE(description, 'Intermediate driving level — stage 1'),
  updated_at = NOW()
WHERE code = 'intermediate';

UPDATE public.membership_levels
SET
  code = 'advanced_1',
  name = 'Advanced 1',
  display_name = 'Advanced 1',
  rank_group = 'advanced',
  level_number = 1,
  rank = 10,
  description = COALESCE(description, 'Advanced driving level — stage 1'),
  updated_at = NOW()
WHERE code = 'advanced';

-- Insert the remaining 18 levels (and re-upsert all 21 for idempotency)
INSERT INTO public.membership_levels (
  code, name, display_name, rank_group, level_number, rank, description, is_active
) VALUES
  ('junior_1', 'Junior 1', 'Junior 1', 'junior', 1, 1,
   'Entry driving level — Junior rank, stage 1', TRUE),
  ('junior_2', 'Junior 2', 'Junior 2', 'junior', 2, 2,
   'Junior rank, stage 2', TRUE),
  ('junior_3', 'Junior 3', 'Junior 3', 'junior', 3, 3,
   'Junior rank, stage 3', TRUE),
  ('intermediate_1', 'Intermediate 1', 'Intermediate 1', 'intermediate', 1, 4,
   'Intermediate driving level — stage 1', TRUE),
  ('intermediate_2', 'Intermediate 2', 'Intermediate 2', 'intermediate', 2, 5,
   'Intermediate rank, stage 2', TRUE),
  ('intermediate_3', 'Intermediate 3', 'Intermediate 3', 'intermediate', 3, 6,
   'Intermediate rank, stage 3', TRUE),
  ('intermediate_plus_1', 'Intermediate+ 1', 'Intermediate+ 1', 'intermediate_plus', 1, 7,
   'Intermediate+ driving level — stage 1', TRUE),
  ('intermediate_plus_2', 'Intermediate+ 2', 'Intermediate+ 2', 'intermediate_plus', 2, 8,
   'Intermediate+ rank, stage 2', TRUE),
  ('intermediate_plus_3', 'Intermediate+ 3', 'Intermediate+ 3', 'intermediate_plus', 3, 9,
   'Intermediate+ rank, stage 3', TRUE),
  ('advanced_1', 'Advanced 1', 'Advanced 1', 'advanced', 1, 10,
   'Advanced driving level — stage 1', TRUE),
  ('advanced_2', 'Advanced 2', 'Advanced 2', 'advanced', 2, 11,
   'Advanced rank, stage 2', TRUE),
  ('advanced_3', 'Advanced 3', 'Advanced 3', 'advanced', 3, 12,
   'Advanced rank, stage 3', TRUE),
  ('advanced_plus_1', 'Advanced+ 1', 'Advanced+ 1', 'advanced_plus', 1, 13,
   'Advanced+ driving level — stage 1', TRUE),
  ('advanced_plus_2', 'Advanced+ 2', 'Advanced+ 2', 'advanced_plus', 2, 14,
   'Advanced+ rank, stage 2', TRUE),
  ('advanced_plus_3', 'Advanced+ 3', 'Advanced+ 3', 'advanced_plus', 3, 15,
   'Advanced+ rank, stage 3', TRUE),
  ('pre_marshall_1', 'Pre-Marshall 1', 'Pre-Marshall 1', 'pre_marshall', 1, 16,
   'Pre-Marshall driving progression — stage 1', TRUE),
  ('pre_marshall_2', 'Pre-Marshall 2', 'Pre-Marshall 2', 'pre_marshall', 2, 17,
   'Pre-Marshall driving progression — stage 2', TRUE),
  ('pre_marshall_3', 'Pre-Marshall 3', 'Pre-Marshall 3', 'pre_marshall', 3, 18,
   'Pre-Marshall driving progression — stage 3', TRUE),
  ('marshall_1', 'Marshall 1', 'Marshall 1', 'marshall', 1, 19,
   'Marshall driving progression — stage 1', TRUE),
  ('marshall_2', 'Marshall 2', 'Marshall 2', 'marshall', 2, 20,
   'Marshall driving progression — stage 2', TRUE),
  ('marshall_3', 'Marshall 3', 'Marshall 3', 'marshall', 3, 21,
   'Marshall driving progression — stage 3 (final)', TRUE)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  display_name = EXCLUDED.display_name,
  rank_group = EXCLUDED.rank_group,
  level_number = EXCLUDED.level_number,
  rank = EXCLUDED.rank,
  description = EXCLUDED.description,
  is_active = TRUE,
  updated_at = NOW();

-- Ensure display_name filled for any rows that somehow missed it
UPDATE public.membership_levels
SET display_name = COALESCE(display_name, name)
WHERE display_name IS NULL;

-- Reinstate uniqueness and add progression constraints
CREATE UNIQUE INDEX IF NOT EXISTS membership_levels_rank_uidx
  ON public.membership_levels (rank);

CREATE UNIQUE INDEX IF NOT EXISTS membership_levels_group_level_uidx
  ON public.membership_levels (rank_group, level_number)
  WHERE rank_group IS NOT NULL AND level_number IS NOT NULL;

ALTER TABLE public.membership_levels
  DROP CONSTRAINT IF EXISTS membership_levels_level_number_check;
ALTER TABLE public.membership_levels
  ADD CONSTRAINT membership_levels_level_number_check
  CHECK (level_number IS NULL OR (level_number >= 1 AND level_number <= 3));

ALTER TABLE public.membership_levels
  DROP CONSTRAINT IF EXISTS membership_levels_rank_group_check;
ALTER TABLE public.membership_levels
  ADD CONSTRAINT membership_levels_rank_group_check
  CHECK (
    rank_group IS NULL OR rank_group IN (
      'junior', 'intermediate', 'intermediate_plus', 'advanced',
      'advanced_plus', 'pre_marshall', 'marshall'
    )
  );

COMMENT ON COLUMN public.membership_levels.rank_group IS
  'Main driving rank group (separate from club RBAC roles).';
COMMENT ON COLUMN public.membership_levels.level_number IS
  'Stage within the rank group: 1, 2, or 3.';
COMMENT ON COLUMN public.membership_levels.rank IS
  'Overall progression order 1–21.';
COMMENT ON COLUMN public.membership_levels.display_name IS
  'Member-facing label e.g. Intermediate+ 2.';

-- ---------------------------------------------------------------------------
-- Club-role promotion requests (separate from driving-level upgrades)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.role_promotion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  current_role_code TEXT NOT NULL,
  requested_role_code TEXT NOT NULL
    CHECK (requested_role_code IN ('pre_marshall', 'marshall')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  trigger_upgrade_request_id UUID REFERENCES public.membership_upgrade_requests(id) ON DELETE SET NULL,
  trigger_level_id UUID REFERENCES public.membership_levels(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT role_promo_not_self_review CHECK (
    reviewed_by IS NULL OR reviewed_by <> member_id
  )
);

CREATE INDEX IF NOT EXISTS idx_role_promo_status
  ON public.role_promotion_requests(status);
CREATE INDEX IF NOT EXISTS idx_role_promo_member
  ON public.role_promotion_requests(member_id);
CREATE INDEX IF NOT EXISTS idx_role_promo_requested_role
  ON public.role_promotion_requests(requested_role_code);

-- One pending request per member per target club role
CREATE UNIQUE INDEX IF NOT EXISTS role_promo_pending_unique
  ON public.role_promotion_requests (member_id, requested_role_code)
  WHERE status = 'pending';

-- One pending driving-level upgrade per member (tighten existing flow)
CREATE UNIQUE INDEX IF NOT EXISTS upgrade_pending_per_member_uidx
  ON public.membership_upgrade_requests (member_id)
  WHERE status = 'pending';

ALTER TABLE public.role_promotion_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS role_promo_select_own ON public.role_promotion_requests;
CREATE POLICY role_promo_select_own ON public.role_promotion_requests
  FOR SELECT TO authenticated
  USING (member_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Track last promotion timestamp on profile (optional denormalized field)
-- ---------------------------------------------------------------------------
ALTER TABLE public.member_profiles
  ADD COLUMN IF NOT EXISTS last_progression_at TIMESTAMPTZ;

-- Backfill last_progression_at from membership_history where available
UPDATE public.member_profiles mp
SET last_progression_at = src.last_at
FROM (
  SELECT member_id, MAX(created_at) AS last_at
  FROM public.membership_history
  GROUP BY member_id
) src
WHERE mp.id = src.member_id
  AND mp.last_progression_at IS NULL;

INSERT INTO public.schema_migrations (id, notes)
VALUES (
  '012_driver_progression_21_levels',
  '21 driving levels (7×3), role_promotion_requests, sequential upgrade uniqueness'
)
ON CONFLICT (id) DO NOTHING;
