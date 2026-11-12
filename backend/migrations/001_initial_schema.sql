-- ============================================================================
-- Keepers Adventures 4x4 — Migration 001: Initial Schema
-- Date: 2026-11-13
-- Safety: ADDITIVE ONLY. Does not DROP existing public tables.
-- Target: Supabase PostgreSQL (auth + storage schemas already present)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Helper: updated_at trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Membership levels
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.membership_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  rank INT NOT NULL UNIQUE,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Roles & permissions (granular RBAC)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (role_id, permission_id)
);

-- ---------------------------------------------------------------------------
-- Member profiles (1:1 with auth.users — passwords stay in auth.users)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.member_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  nationality TEXT,
  gender TEXT,
  bio TEXT,
  avatar_url TEXT,
  membership_level_id UUID REFERENCES public.membership_levels(id),
  completed_trips INT NOT NULL DEFAULT 0 CHECK (completed_trips >= 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES auth.users(id),
  rejected_at TIMESTAMPTZ,
  rejected_by UUID REFERENCES auth.users(id),
  rejection_reason TEXT,
  suspended_at TIMESTAMPTZ,
  suspended_by UUID REFERENCES auth.users(id),
  suspension_reason TEXT,
  privacy_show_vehicle BOOLEAN NOT NULL DEFAULT TRUE,
  privacy_show_social BOOLEAN NOT NULL DEFAULT TRUE,
  agreement_accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_member_profiles_status ON public.member_profiles(status);
CREATE INDEX IF NOT EXISTS idx_member_profiles_membership ON public.member_profiles(membership_level_id);
CREATE INDEX IF NOT EXISTS idx_member_profiles_username ON public.member_profiles(username);
CREATE INDEX IF NOT EXISTS idx_member_profiles_email ON public.member_profiles(email);

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES auth.users(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user ON public.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON public.user_roles(role_id);

-- ---------------------------------------------------------------------------
-- Vehicles, social, emergency contacts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  manufacturer TEXT NOT NULL,
  model TEXT NOT NULL,
  model_year TEXT,
  vin TEXT,
  image_url TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_vehicles_user ON public.vehicles(user_id);

CREATE TABLE IF NOT EXISTS public.social_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'facebook', 'tiktok', 'other')),
  handle_or_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, platform)
);

CREATE TABLE IF NOT EXISTS public.emergency_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  name TEXT,
  phone TEXT NOT NULL,
  relationship TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emergency_contacts_user ON public.emergency_contacts(user_id);

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  trips BOOLEAN NOT NULL DEFAULT TRUE,
  events BOOLEAN NOT NULL DEFAULT TRUE,
  club BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Trips / drives
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  destination TEXT NOT NULL,
  meeting_point TEXT,
  trip_date DATE NOT NULL,
  trip_time TIME,
  difficulty TEXT NOT NULL DEFAULT 'Moderate'
    CHECK (difficulty IN ('Easy', 'Moderate', 'Advanced', 'Expert')),
  trip_type TEXT,
  required_membership_level_id UUID REFERENCES public.membership_levels(id),
  min_trips_required INT NOT NULL DEFAULT 0 CHECK (min_trips_required >= 0),
  cover_image_url TEXT,
  max_participants INT NOT NULL DEFAULT 20 CHECK (max_participants > 0),
  vehicle_requirements TEXT,
  instructions TEXT,
  route_summary TEXT,
  location_label TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  organizer_id UUID REFERENCES public.member_profiles(id),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'cancelled', 'completed')),
  published_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_trips_date ON public.trips(trip_date);
CREATE INDEX IF NOT EXISTS idx_trips_status ON public.trips(status);
CREATE INDEX IF NOT EXISTS idx_trips_organizer ON public.trips(organizer_id);

CREATE TABLE IF NOT EXISTS public.trip_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'registered'
    CHECK (status IN ('registered', 'waitlist', 'cancelled', 'rejected')),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (trip_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_registrations_trip ON public.trip_registrations(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_registrations_user ON public.trip_registrations(user_id);
CREATE INDEX IF NOT EXISTS idx_trip_registrations_status ON public.trip_registrations(status);

-- Attendance only for confirmed participation; unique per trip+user
CREATE TABLE IF NOT EXISTS public.trip_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  registration_id UUID REFERENCES public.trip_registrations(id) ON DELETE SET NULL,
  attended BOOLEAN NOT NULL DEFAULT TRUE,
  marked_by UUID NOT NULL REFERENCES auth.users(id),
  marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (trip_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_attendance_trip ON public.trip_attendance(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_attendance_user ON public.trip_attendance(user_id);

-- Configurable rating criteria (defaults seeded; editable by admin)
CREATE TABLE IF NOT EXISTS public.rating_criteria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  min_score INT NOT NULL DEFAULT 1,
  max_score INT NOT NULL DEFAULT 5,
  display_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.trip_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  rated_by UUID NOT NULL REFERENCES public.member_profiles(id),
  overall_score NUMERIC(3,2),
  private_feedback TEXT,
  public_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (trip_id, member_id, rated_by)
);

CREATE TABLE IF NOT EXISTS public.trip_rating_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rating_id UUID NOT NULL REFERENCES public.trip_ratings(id) ON DELETE CASCADE,
  criterion_id UUID NOT NULL REFERENCES public.rating_criteria(id) ON DELETE RESTRICT,
  score INT NOT NULL CHECK (score >= 1 AND score <= 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rating_id, criterion_id)
);

CREATE TABLE IF NOT EXISTS public.membership_upgrade_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  from_level_id UUID REFERENCES public.membership_levels(id),
  to_level_id UUID NOT NULL REFERENCES public.membership_levels(id),
  recommended_by UUID NOT NULL REFERENCES public.member_profiles(id),
  trip_id UUID REFERENCES public.trips(id) ON DELETE SET NULL,
  rating_id UUID REFERENCES public.trip_ratings(id) ON DELETE SET NULL,
  recommendation_notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  decision_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT upgrade_not_self_review CHECK (
    reviewed_by IS NULL OR reviewed_by <> recommended_by
  )
);

CREATE INDEX IF NOT EXISTS idx_upgrade_requests_status ON public.membership_upgrade_requests(status);
CREATE INDEX IF NOT EXISTS idx_upgrade_requests_member ON public.membership_upgrade_requests(member_id);

CREATE TABLE IF NOT EXISTS public.membership_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  from_level_id UUID REFERENCES public.membership_levels(id),
  to_level_id UUID NOT NULL REFERENCES public.membership_levels(id),
  change_reason TEXT,
  upgrade_request_id UUID REFERENCES public.membership_upgrade_requests(id),
  changed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Media
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trip_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
  storage_path TEXT NOT NULL,
  public_url TEXT,
  thumbnail_url TEXT,
  caption TEXT,
  display_order INT NOT NULL DEFAULT 0,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_trip_media_trip ON public.trip_media(trip_id);

CREATE TABLE IF NOT EXISTS public.member_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
  storage_path TEXT NOT NULL,
  public_url TEXT,
  caption TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'members', 'public')),
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.hero_slides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT,
  subtitle TEXT,
  image_url TEXT NOT NULL,
  trip_id UUID REFERENCES public.trips(id) ON DELETE SET NULL,
  display_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.gallery_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url TEXT NOT NULL,
  caption TEXT,
  trip_id UUID REFERENCES public.trips(id) ON DELETE SET NULL,
  display_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- Sponsors, events, announcements, notifications, documents, settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sponsors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  logo_url TEXT,
  website_url TEXT,
  display_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  event_date DATE NOT NULL,
  location TEXT,
  image_url TEXT,
  created_by UUID REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'cancelled', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  target_audience TEXT NOT NULL DEFAULT 'all'
    CHECK (target_audience IN ('all', 'members', 'marshalls', 'admins', 'membership_level', 'role')),
  target_membership_level_id UUID REFERENCES public.membership_levels(id),
  target_role_id UUID REFERENCES public.roles(id),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  published_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL
    CHECK (type IN ('trip', 'registration', 'reminder', 'event', 'club', 'admin', 'upgrade', 'announcement')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  announcement_id UUID REFERENCES public.announcements(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications(user_id) WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  document_type TEXT NOT NULL DEFAULT 'text'
    CHECK (document_type IN ('text', 'pdf', 'url')),
  file_url TEXT,
  version TEXT,
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.app_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  description TEXT,
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs(created_at DESC);

-- Schema migration tracking
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'membership_levels','roles','member_profiles','vehicles','social_links',
    'emergency_contacts','notification_preferences','trips','trip_registrations',
    'trip_attendance','rating_criteria','trip_ratings','membership_upgrade_requests',
    'hero_slides','sponsors','events','announcements','documents','app_settings'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t, t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Attendance → completed_trips (only when attended = true)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_completed_trips()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    UPDATE public.member_profiles mp
    SET completed_trips = (
      SELECT COUNT(*)::INT
      FROM public.trip_attendance ta
      WHERE ta.user_id = NEW.user_id AND ta.attended = TRUE
    )
    WHERE mp.id = NEW.user_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.member_profiles mp
    SET completed_trips = (
      SELECT COUNT(*)::INT
      FROM public.trip_attendance ta
      WHERE ta.user_id = OLD.user_id AND ta.attended = TRUE
    )
    WHERE mp.id = OLD.user_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_completed_trips ON public.trip_attendance;
CREATE TRIGGER trg_sync_completed_trips
AFTER INSERT OR UPDATE OR DELETE ON public.trip_attendance
FOR EACH ROW EXECUTE FUNCTION public.sync_completed_trips();

-- ---------------------------------------------------------------------------
-- RLS: enable on all public tables. Backend uses service_role (bypasses RLS).
-- Clients must not hit tables directly for privileged ops.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.table_name);
  END LOOP;
END $$;

-- Deny-by-default for anon; authenticated read of published content via API preferred.
-- Minimal policies for defense-in-depth if PostgREST is ever exposed:

DROP POLICY IF EXISTS member_profiles_self_select ON public.member_profiles;
CREATE POLICY member_profiles_self_select ON public.member_profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR status = 'approved');

DROP POLICY IF EXISTS trips_published_select ON public.trips;
CREATE POLICY trips_published_select ON public.trips
  FOR SELECT TO authenticated
  USING (status = 'published' AND deleted_at IS NULL);

DROP POLICY IF EXISTS sponsors_active_select ON public.sponsors;
CREATE POLICY sponsors_active_select ON public.sponsors
  FOR SELECT TO authenticated
  USING (is_active = TRUE AND deleted_at IS NULL);

DROP POLICY IF EXISTS announcements_published_select ON public.announcements;
CREATE POLICY announcements_published_select ON public.announcements
  FOR SELECT TO authenticated
  USING (status = 'published' AND deleted_at IS NULL);

DROP POLICY IF EXISTS notifications_own ON public.notifications;
CREATE POLICY notifications_own ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS documents_published_select ON public.documents;
CREATE POLICY documents_published_select ON public.documents
  FOR SELECT TO authenticated
  USING (is_published = TRUE);

DROP POLICY IF EXISTS hero_slides_active_select ON public.hero_slides;
CREATE POLICY hero_slides_active_select ON public.hero_slides
  FOR SELECT TO authenticated
  USING (is_active = TRUE);

DROP POLICY IF EXISTS gallery_active_select ON public.gallery_items;
CREATE POLICY gallery_active_select ON public.gallery_items
  FOR SELECT TO authenticated
  USING (is_active = TRUE AND deleted_at IS NULL);

DROP POLICY IF EXISTS rating_criteria_active_select ON public.rating_criteria;
CREATE POLICY rating_criteria_active_select ON public.rating_criteria
  FOR SELECT TO authenticated
  USING (is_active = TRUE);

DROP POLICY IF EXISTS membership_levels_active_select ON public.membership_levels;
CREATE POLICY membership_levels_active_select ON public.membership_levels
  FOR SELECT TO authenticated
  USING (is_active = TRUE);

-- Storage buckets (idempotent)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('avatars', 'avatars', true, 5242880, ARRAY['image/jpeg','image/png','image/webp','image/heic']),
  ('vehicles', 'vehicles', true, 10485760, ARRAY['image/jpeg','image/png','image/webp','image/heic']),
  ('trips', 'trips', true, 52428800, ARRAY['image/jpeg','image/png','image/webp','image/heic','video/mp4','video/quicktime','video/webm']),
  ('gallery', 'gallery', true, 52428800, ARRAY['image/jpeg','image/png','image/webp','video/mp4','video/quicktime']),
  ('sponsors', 'sponsors', true, 5242880, ARRAY['image/jpeg','image/png','image/webp','image/svg+xml']),
  ('documents', 'documents', false, 20971520, ARRAY['application/pdf','image/jpeg','image/png'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.schema_migrations (id, notes)
VALUES ('001_initial_schema', 'Initial Keepers Adventures platform schema')
ON CONFLICT (id) DO NOTHING;
