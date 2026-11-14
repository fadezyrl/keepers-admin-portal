-- Keepers trip messaging: conversations, messages, attachments, receipts, moderation.
-- Additive only. Socket.IO delivers live events; Postgres remains source of truth.

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
INSERT INTO public.permissions (code, name, description) VALUES
  ('chat.read', 'Read trip chats', 'View authorized trip group and private conversations'),
  ('chat.send', 'Send chat messages', 'Send messages and attachments in authorized conversations'),
  ('chat.moderate', 'Moderate chats', 'Admin moderation: delete messages, archive, review reports')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name, description = EXCLUDED.description;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE p.code IN ('chat.read', 'chat.send')
  AND r.code IN ('member', 'pre_marshall', 'marshall', 'admin', 'super_admin')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE p.code = 'chat.moderate'
  AND r.code IN ('admin', 'super_admin')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('group', 'private')),
  -- Explicit private-chat member (NULL for group). Enforces uniqueness below.
  private_member_id UUID REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  title TEXT,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  is_readonly BOOLEAN NOT NULL DEFAULT FALSE,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT conversations_private_member_ck CHECK (
    (type = 'group' AND private_member_id IS NULL)
    OR (type = 'private' AND private_member_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_one_group_per_trip
  ON public.conversations (trip_id)
  WHERE type = 'group';

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_one_private_per_trip_member
  ON public.conversations (trip_id, private_member_id)
  WHERE type = 'private';

CREATE INDEX IF NOT EXISTS idx_conversations_trip ON public.conversations (trip_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message
  ON public.conversations (last_message_at DESC NULLS LAST);

DROP TRIGGER IF EXISTS trg_conversations_updated_at ON public.conversations;
CREATE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Participants
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversation_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  role_in_chat TEXT NOT NULL CHECK (
    role_in_chat IN ('organizer', 'member', 'pre_marshall', 'moderator')
  ),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_muted BOOLEAN NOT NULL DEFAULT FALSE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  last_read_at TIMESTAMPTZ,
  last_delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT conversation_participants_unique UNIQUE (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_participants_user_active
  ON public.conversation_participants (user_id)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_conversation_participants_conversation
  ON public.conversation_participants (conversation_id)
  WHERE is_active = TRUE;

DROP TRIGGER IF EXISTS trg_conversation_participants_updated_at ON public.conversation_participants;
CREATE TRIGGER trg_conversation_participants_updated_at
  BEFORE UPDATE ON public.conversation_participants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES public.member_profiles(id) ON DELETE SET NULL,
  message_type TEXT NOT NULL CHECK (
    message_type IN ('text', 'image', 'video', 'voice', 'system')
  ),
  content TEXT,
  client_message_id UUID,
  reply_to_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES public.member_profiles(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_idempotency
  ON public.messages (conversation_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON public.messages (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_sender
  ON public.messages (sender_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Attachments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.message_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES public.messages(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'voice')),
  bucket TEXT NOT NULL DEFAULT 'chat',
  storage_path TEXT NOT NULL,
  public_url TEXT,
  mime_type TEXT NOT NULL,
  byte_size INT NOT NULL CHECK (byte_size > 0),
  width INT,
  height INT,
  duration_ms INT,
  waveform_json JSONB,
  thumbnail_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Attachment may be uploaded before message row exists; linked on send.
  CONSTRAINT message_attachments_size_ck CHECK (byte_size <= 52428800)
);

CREATE INDEX IF NOT EXISTS idx_message_attachments_message
  ON public.message_attachments (message_id);
CREATE INDEX IF NOT EXISTS idx_message_attachments_conversation
  ON public.message_attachments (conversation_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Receipts (created for active recipients at send time; updated on device ACK)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.message_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT message_receipts_unique UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_message_receipts_user_unread
  ON public.message_receipts (user_id)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_message_receipts_message
  ON public.message_receipts (message_id);

-- ---------------------------------------------------------------------------
-- Reports + moderation audit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  reported_user_id UUID REFERENCES public.member_profiles(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  reviewed_by UUID REFERENCES public.member_profiles(id) ON DELETE SET NULL,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_chat_reports_updated_at ON public.chat_reports;
CREATE TRIGGER trg_chat_reports_updated_at
  BEFORE UPDATE ON public.chat_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.chat_moderation_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  target_user_id UUID REFERENCES public.member_profiles(id) ON DELETE SET NULL,
  reason TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_moderation_created
  ON public.chat_moderation_actions (created_at DESC);

-- ---------------------------------------------------------------------------
-- Notification type: add chat
-- ---------------------------------------------------------------------------
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'trip', 'registration', 'reminder', 'event', 'club', 'admin',
    'upgrade', 'announcement', 'chat'
  ));

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS chat BOOLEAN NOT NULL DEFAULT TRUE;

-- ---------------------------------------------------------------------------
-- Storage bucket (private chat media)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat',
  'chat',
  false,
  52428800,
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'video/mp4', 'video/quicktime', 'video/webm',
    'audio/mp4', 'audio/m4a', 'audio/aac', 'audio/mpeg', 'audio/x-m4a'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- RLS: deny direct client access; Express service-role is source of writes.
-- Authenticated users may SELECT only rows for conversations they actively join.
-- ---------------------------------------------------------------------------
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_moderation_actions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_active_chat_participant(p_conversation_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_participants cp
    WHERE cp.conversation_id = p_conversation_id
      AND cp.user_id = auth.uid()
      AND cp.is_active = TRUE
  );
$$;

DROP POLICY IF EXISTS conversations_select_participant ON public.conversations;
CREATE POLICY conversations_select_participant ON public.conversations
  FOR SELECT TO authenticated
  USING (public.is_active_chat_participant(id));

DROP POLICY IF EXISTS conversation_participants_select_own_room ON public.conversation_participants;
CREATE POLICY conversation_participants_select_own_room ON public.conversation_participants
  FOR SELECT TO authenticated
  USING (public.is_active_chat_participant(conversation_id));

DROP POLICY IF EXISTS messages_select_participant ON public.messages;
CREATE POLICY messages_select_participant ON public.messages
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.is_active_chat_participant(conversation_id)
  );

DROP POLICY IF EXISTS message_attachments_select_participant ON public.message_attachments;
CREATE POLICY message_attachments_select_participant ON public.message_attachments
  FOR SELECT TO authenticated
  USING (public.is_active_chat_participant(conversation_id));

DROP POLICY IF EXISTS message_receipts_select_own ON public.message_receipts;
CREATE POLICY message_receipts_select_own ON public.message_receipts
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS chat_reports_select_own ON public.chat_reports;
CREATE POLICY chat_reports_select_own ON public.chat_reports
  FOR SELECT TO authenticated
  USING (reporter_id = auth.uid());

-- No INSERT/UPDATE/DELETE policies for authenticated — API uses service role.

INSERT INTO public.schema_migrations (id, notes)
VALUES (
  '009_chat_messaging',
  'Trip group/private chat, attachments, receipts, moderation, chat storage bucket'
)
ON CONFLICT (id) DO NOTHING;
