-- ============================================================================
-- Keepers Adventures 4x4 — Migration 002: Seed defaults
-- Additive seed for roles, permissions, membership levels, rating criteria,
-- documents, and app settings. Safe to re-run (ON CONFLICT DO NOTHING / UPDATE).
-- ============================================================================

-- Membership levels (align with mobile: Junior / Intermediate / Advanced)
INSERT INTO public.membership_levels (code, name, rank, description) VALUES
  ('junior', 'Junior', 0, 'Entry membership level'),
  ('intermediate', 'Intermediate', 1, 'Intermediate membership level'),
  ('advanced', 'Advanced', 2, 'Advanced membership level')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  rank = EXCLUDED.rank,
  description = EXCLUDED.description,
  updated_at = NOW();

-- Roles
INSERT INTO public.roles (code, name, description, is_system) VALUES
  ('member', 'Member', 'Standard club member', TRUE),
  ('pre_marshall', 'Pre-Marshall', 'Member with limited assigned Marshall permissions', TRUE),
  ('marshall', 'Marshall', 'Drive organizer with attendance and rating permissions', TRUE),
  ('admin', 'Admin', 'Platform administrator', TRUE),
  ('super_admin', 'Super Admin', 'Full platform control', TRUE)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_system = EXCLUDED.is_system,
  updated_at = NOW();

-- Permissions
INSERT INTO public.permissions (code, name, description) VALUES
  ('members.read', 'Read members', 'View member directory and profiles'),
  ('members.manage', 'Manage members', 'Approve, reject, suspend members'),
  ('members.emergency.read', 'Read emergency contacts', 'View emergency contact details'),
  ('roles.assign', 'Assign roles', 'Assign or remove user roles'),
  ('trips.read', 'Read trips', 'View published trips'),
  ('trips.create', 'Create trips', 'Create drives'),
  ('trips.manage', 'Manage trips', 'Edit, publish, cancel any trip'),
  ('trips.manage_own', 'Manage own trips', 'Edit trips organized by self'),
  ('registrations.manage', 'Manage registrations', 'Approve/reject/waitlist registrations'),
  ('attendance.mark', 'Mark attendance', 'Mark trip attendance'),
  ('ratings.create', 'Create ratings', 'Rate members after drives'),
  ('upgrades.recommend', 'Recommend upgrades', 'Submit membership upgrade recommendations'),
  ('upgrades.review', 'Review upgrades', 'Approve or reject upgrade recommendations'),
  ('media.manage', 'Manage media', 'Upload and organize media'),
  ('sponsors.manage', 'Manage sponsors', 'CRUD sponsors'),
  ('announcements.manage', 'Manage announcements', 'Create and publish announcements'),
  ('documents.manage', 'Manage documents', 'Edit club documents'),
  ('settings.manage', 'Manage settings', 'Edit app settings and rating criteria'),
  ('dashboard.read', 'Read dashboard', 'View admin analytics'),
  ('audit.read', 'Read audit logs', 'View audit history'),
  ('admins.manage', 'Manage admins', 'Manage administrator accounts')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description;

-- Role → permission mapping helper
WITH rp AS (
  SELECT v.role_code, v.perm_code
  FROM (VALUES
    -- member
    ('member', 'members.read'),
    ('member', 'trips.read'),
    -- pre_marshall (base + limited; explicit grants later can expand)
    ('pre_marshall', 'members.read'),
    ('pre_marshall', 'trips.read'),
    ('pre_marshall', 'attendance.mark'),
    -- marshall
    ('marshall', 'members.read'),
    ('marshall', 'trips.read'),
    ('marshall', 'trips.create'),
    ('marshall', 'trips.manage_own'),
    ('marshall', 'attendance.mark'),
    ('marshall', 'ratings.create'),
    ('marshall', 'upgrades.recommend'),
    ('marshall', 'media.manage'),
    -- admin
    ('admin', 'members.read'),
    ('admin', 'members.manage'),
    ('admin', 'members.emergency.read'),
    ('admin', 'roles.assign'),
    ('admin', 'trips.read'),
    ('admin', 'trips.create'),
    ('admin', 'trips.manage'),
    ('admin', 'trips.manage_own'),
    ('admin', 'registrations.manage'),
    ('admin', 'attendance.mark'),
    ('admin', 'ratings.create'),
    ('admin', 'upgrades.recommend'),
    ('admin', 'upgrades.review'),
    ('admin', 'media.manage'),
    ('admin', 'sponsors.manage'),
    ('admin', 'announcements.manage'),
    ('admin', 'documents.manage'),
    ('admin', 'settings.manage'),
    ('admin', 'dashboard.read'),
    ('admin', 'audit.read'),
    -- super_admin: all permissions
    ('super_admin', 'members.read'),
    ('super_admin', 'members.manage'),
    ('super_admin', 'members.emergency.read'),
    ('super_admin', 'roles.assign'),
    ('super_admin', 'trips.read'),
    ('super_admin', 'trips.create'),
    ('super_admin', 'trips.manage'),
    ('super_admin', 'trips.manage_own'),
    ('super_admin', 'registrations.manage'),
    ('super_admin', 'attendance.mark'),
    ('super_admin', 'ratings.create'),
    ('super_admin', 'upgrades.recommend'),
    ('super_admin', 'upgrades.review'),
    ('super_admin', 'media.manage'),
    ('super_admin', 'sponsors.manage'),
    ('super_admin', 'announcements.manage'),
    ('super_admin', 'documents.manage'),
    ('super_admin', 'settings.manage'),
    ('super_admin', 'dashboard.read'),
    ('super_admin', 'audit.read'),
    ('super_admin', 'admins.manage')
  ) AS v(role_code, perm_code)
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM rp
JOIN public.roles r ON r.code = rp.role_code
JOIN public.permissions p ON p.code = rp.perm_code
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Configurable rating criteria (defaults; editable)
INSERT INTO public.rating_criteria (code, name, description, min_score, max_score, display_order) VALUES
  ('driving', 'Driving', 'Vehicle control and driving skill on the drive', 1, 5, 1),
  ('safety', 'Safety', 'Adherence to safety protocols and convoy discipline', 1, 5, 2),
  ('teamwork', 'Teamwork', 'Cooperation with Marshalls and fellow members', 1, 5, 3),
  ('preparedness', 'Preparedness', 'Equipment, recovery kit, and readiness', 1, 5, 4)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  display_order = EXCLUDED.display_order,
  updated_at = NOW();

-- Club documents (About section structure)
INSERT INTO public.documents (slug, title, content, document_type, version) VALUES
  ('protocols', 'Keepers Adventures Protocols', 'Club protocols content managed by Admin.', 'text', '1.0'),
  ('safety-briefing', 'Safety Briefing & Disclaimer', 'Safety briefing and disclaimer content managed by Admin.', 'text', '1.0'),
  ('brochure', 'Keepers Adventures Brochure', 'Club brochure content managed by Admin.', 'text', '1.0'),
  ('terms', 'Terms of Service', 'Terms of service content managed by Admin.', 'text', '1.0'),
  ('privacy', 'Privacy Policy', 'Privacy policy content managed by Admin.', 'text', '1.0')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.app_settings (key, value, description) VALUES
  ('registration_requires_approval', 'true'::jsonb, 'New member signups require Admin approval before app access'),
  ('trip_join_requires_approval', 'false'::jsonb, 'If true, trip registrations need Admin/Marshall approval'),
  ('rating_scale', '{"min":1,"max":5}'::jsonb, 'Global rating scale bounds'),
  ('app_name', '"Keepers Adventures"'::jsonb, 'Application display name'),
  ('support_email', '"support@keepers.ae"'::jsonb, 'Support contact email')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.schema_migrations (id, notes)
VALUES ('002_seed_defaults', 'Default roles, permissions, levels, criteria, documents, settings')
ON CONFLICT (id) DO NOTHING;
