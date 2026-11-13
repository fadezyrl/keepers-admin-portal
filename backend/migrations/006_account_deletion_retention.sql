-- Permanent account deletion must scrub PII and remove Auth users while retaining
-- anonymized member_profiles rows for trip/attendance/rating history.
-- Dropping ON DELETE CASCADE prevents Auth deletion from wiping club history.

ALTER TABLE public.member_profiles
  DROP CONSTRAINT IF EXISTS member_profiles_id_fkey;

COMMENT ON COLUMN public.member_profiles.id IS
  'Matches auth.users.id while the Auth account exists. Retained after Auth deletion for historical trip, attendance, and rating records.';

-- Soft-deleted anonymized profiles stay queryable for Admin audit filters.
CREATE INDEX IF NOT EXISTS idx_member_profiles_deleted_at
  ON public.member_profiles (deleted_at)
  WHERE deleted_at IS NOT NULL;

INSERT INTO public.schema_migrations (id, notes)
VALUES (
  '006_account_deletion_retention',
  'Drop member_profiles→auth.users CASCADE so permanent deletion can scrub PII and retain history'
)
ON CONFLICT (id) DO NOTHING;
