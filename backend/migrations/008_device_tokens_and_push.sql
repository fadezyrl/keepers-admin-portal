-- Device tokens + push delivery metadata for FCM.
-- Additive only. Extends existing notifications / notification_preferences.

CREATE TABLE IF NOT EXISTS public.device_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  fcm_token TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  device_id TEXT,
  app_version TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT device_tokens_token_unique UNIQUE (fcm_token)
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user_active
  ON public.device_tokens (user_id)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_device_tokens_device_id
  ON public.device_tokens (user_id, device_id)
  WHERE device_id IS NOT NULL;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS push_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (push_status IN ('pending', 'sent', 'partial', 'failed', 'skipped', 'none'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_idempotency
  ON public.notifications (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS registrations BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS ratings BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS device_tokens_own ON public.device_tokens;
CREATE POLICY device_tokens_own ON public.device_tokens
  FOR SELECT
  USING (user_id = auth.uid());

INSERT INTO public.schema_migrations (id, notes)
VALUES ('008_device_tokens_and_push', 'FCM device tokens + notification push metadata')
ON CONFLICT (id) DO NOTHING;
