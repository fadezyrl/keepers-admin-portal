-- UGC moderation: report taxonomy, member reports, user blocks, admin review support.
-- Additive only — preserves existing chat history and report rows.

-- ---------------------------------------------------------------------------
-- Extend chat_reports
-- ---------------------------------------------------------------------------
ALTER TABLE public.chat_reports
  ALTER COLUMN conversation_id DROP NOT NULL;

ALTER TABLE public.chat_reports
  ADD COLUMN IF NOT EXISTS report_type TEXT NOT NULL DEFAULT 'message';

ALTER TABLE public.chat_reports
  ADD COLUMN IF NOT EXISTS details TEXT;

ALTER TABLE public.chat_reports
  DROP CONSTRAINT IF EXISTS chat_reports_report_type_check;

ALTER TABLE public.chat_reports
  ADD CONSTRAINT chat_reports_report_type_check
  CHECK (report_type IN ('message', 'member'));

-- Normalize legacy free-text reasons before enforcing taxonomy.
UPDATE public.chat_reports
SET reason = CASE
  WHEN lower(trim(reason)) IN (
    'spam', 'harassment', 'hate', 'sexual_content', 'violence', 'other'
  ) THEN lower(trim(reason))
  WHEN lower(reason) LIKE '%spam%' THEN 'spam'
  WHEN lower(reason) LIKE '%harass%' OR lower(reason) LIKE '%bully%' THEN 'harassment'
  WHEN lower(reason) LIKE '%hate%' OR lower(reason) LIKE '%discrimin%' THEN 'hate'
  WHEN lower(reason) LIKE '%sexual%' OR lower(reason) LIKE '%nsfw%' THEN 'sexual_content'
  WHEN lower(reason) LIKE '%violen%' OR lower(reason) LIKE '%threat%' THEN 'violence'
  ELSE 'other'
END
WHERE reason IS NOT NULL
  AND lower(trim(reason)) NOT IN (
    'spam', 'harassment', 'hate', 'sexual_content', 'violence', 'other'
  );

ALTER TABLE public.chat_reports
  DROP CONSTRAINT IF EXISTS chat_reports_reason_check;

ALTER TABLE public.chat_reports
  ADD CONSTRAINT chat_reports_reason_check
  CHECK (reason IN (
    'spam',
    'harassment',
    'hate',
    'sexual_content',
    'violence',
    'other'
  ));

-- Message reports must reference a message; member reports may omit it.
ALTER TABLE public.chat_reports
  DROP CONSTRAINT IF EXISTS chat_reports_type_refs_check;

ALTER TABLE public.chat_reports
  ADD CONSTRAINT chat_reports_type_refs_check
  CHECK (
    (report_type = 'message' AND message_id IS NOT NULL)
    OR (report_type = 'member' AND reported_user_id IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_reports_open_message
  ON public.chat_reports (reporter_id, message_id)
  WHERE report_type = 'message'
    AND message_id IS NOT NULL
    AND status IN ('open', 'reviewing');

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_reports_open_member
  ON public.chat_reports (reporter_id, reported_user_id)
  WHERE report_type = 'member'
    AND reported_user_id IS NOT NULL
    AND status IN ('open', 'reviewing');

CREATE INDEX IF NOT EXISTS idx_chat_reports_status_created
  ON public.chat_reports (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_reports_reported_user
  ON public.chat_reports (reported_user_id, created_at DESC)
  WHERE reported_user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- User blocks (viewer-scoped; does not affect trip membership)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_user_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  blocked_user_id UUID NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chat_user_blocks_no_self CHECK (blocker_id <> blocked_user_id),
  CONSTRAINT chat_user_blocks_unique UNIQUE (blocker_id, blocked_user_id)
);

DROP TRIGGER IF EXISTS trg_chat_user_blocks_updated_at ON public.chat_user_blocks;
CREATE TRIGGER trg_chat_user_blocks_updated_at
  BEFORE UPDATE ON public.chat_user_blocks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_chat_user_blocks_blocker
  ON public.chat_user_blocks (blocker_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_user_blocks_blocked
  ON public.chat_user_blocks (blocked_user_id);

ALTER TABLE public.chat_user_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_user_blocks_select_own ON public.chat_user_blocks;
CREATE POLICY chat_user_blocks_select_own ON public.chat_user_blocks
  FOR SELECT TO authenticated
  USING (blocker_id = auth.uid());

-- No INSERT/UPDATE/DELETE policies — Express service role is the write path.

INSERT INTO public.schema_migrations (id, notes)
VALUES (
  '013_chat_ugc_moderation',
  'UGC report taxonomy, member reports, user blocks, admin moderation indexes'
)
ON CONFLICT (id) DO NOTHING;
