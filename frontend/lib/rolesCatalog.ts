/**
 * Human-readable role catalog mapped to real backend permission codes.
 * Matrix cells reflect effective capability (service-level checks), not raw grants alone.
 */

export const ROLE_ORDER = [
  "super_admin",
  "admin",
  "marshall",
  "pre_marshall",
  "member",
] as const;

export type RoleCode = (typeof ROLE_ORDER)[number];

export type AccessLevel =
  | "allowed"
  | "own_drives"
  | "assigned_drives"
  | "not_allowed"
  | "unavailable";

export type MatrixActivity = {
  id: string;
  label: string;
  /** Permission codes that typically enable this activity */
  permissions?: string[];
  /**
   * Effective access by role after backend scope checks.
   * Prefer this over raw permission presence when set.
   */
  effective?: Partial<Record<RoleCode, AccessLevel>>;
};

export type MatrixCategory = {
  id: string;
  label: string;
  activities: MatrixActivity[];
};

export type RoleMeta = {
  code: RoleCode;
  name: string;
  shortDescription: string;
  responsibilities: string[];
  /** Extra access gained when this role is added (shown before confirm) */
  accessGains: string[];
  restrictedNotes: string[];
  assignableByAdmin: boolean;
};

export const ROLE_META: Record<RoleCode, RoleMeta> = {
  super_admin: {
    code: "super_admin",
    name: "Super Admin",
    shortDescription:
      "Complete platform-level authority, including Admin management.",
    responsibilities: [
      "Full access to every admin module and setting",
      "Manage Admin accounts and Super Admin privileges",
      "Override and protect critical platform operations",
    ],
    accessGains: [
      "Full platform control across members, trips, content and settings",
      "Ability to manage Admin accounts",
      "Access to audit logs and administrative safeguards",
    ],
    restrictedNotes: [
      "The last Super Admin / Admin account cannot be removed",
      "Only Super Admins can grant or revoke Super Admin",
    ],
    assignableByAdmin: false,
  },
  admin: {
    code: "admin",
    name: "Admin",
    shortDescription:
      "Manages members, Marshalls, Pre-Marshalls, trips, registrations, content, ratings and membership upgrade approvals.",
    responsibilities: [
      "Approve, reject, deactivate and permanently delete members",
      "Assign Marshall and Pre-Marshall roles",
      "Manage all trips, registrations, ratings and upgrade reviews",
      "Maintain club content, sponsors, documents and settings",
    ],
    accessGains: [
      "Manage the full member directory and account status",
      "Create and manage all drives and registrations",
      "Mark attendance, submit ratings and review upgrade recommendations",
      "Assign Marshall / Pre-Marshall roles (not Admin)",
    ],
    restrictedNotes: [
      "Cannot manage Super Admin unless also Super Admin",
      "Admin role itself requires Super Admin (admins.manage) to assign",
    ],
    assignableByAdmin: false,
  },
  marshall: {
    code: "marshall",
    name: "Marshall",
    shortDescription:
      "Organizes and manages their own drives, participants, attendance, ratings and upgrade recommendations.",
    responsibilities: [
      "Create and manage their own drives",
      "Mark attendance on drives they organize",
      "Rate eligible participants after drives",
      "Recommend membership upgrades",
    ],
    accessGains: [
      "Create new drives and manage the ones they organize",
      "Mark attendance on their own drives",
      "Submit ratings for eligible participants",
      "Recommend membership upgrades after drives",
      "Upload and manage drive media for their trips",
    ],
    restrictedNotes: [
      "Cannot manage other Marshalls’ drives",
      "Cannot approve membership upgrades or assign roles",
      "Member access is retained alongside Marshall privileges",
    ],
    assignableByAdmin: true,
  },
  pre_marshall: {
    code: "pre_marshall",
    name: "Pre-Marshall",
    shortDescription:
      "Assists with assigned drives and has limited, view-only access to assigned drive information.",
    responsibilities: [
      "View drives they are assigned to assist",
      "Support Marshalls with limited operational visibility",
    ],
    accessGains: [
      "View details for drives they are assigned to",
      "Retain standard Member profile and trip participation access",
    ],
    restrictedNotes: [
      "Cannot create or edit drives",
      "Cannot mark attendance (backend requires organizer or Admin authority)",
      "Cannot submit ratings or recommend upgrades",
    ],
    assignableByAdmin: true,
  },
  member: {
    code: "member",
    name: "Member",
    shortDescription:
      "Standard club member who manages their profile and participates in trips.",
    responsibilities: [
      "Maintain profile and vehicle details",
      "Browse and join published trips",
      "Appear in the member directory where allowed",
    ],
    accessGains: [
      "Standard club access to profile and published trips",
      "Directory visibility according to club settings",
    ],
    restrictedNotes: [
      "No drive organization or attendance tools",
      "No role assignment or membership approval authority",
    ],
    assignableByAdmin: true,
  },
};

export const MATRIX_CATEGORIES: MatrixCategory[] = [
  {
    id: "trips",
    label: "Trip management",
    activities: [
      {
        id: "trips.view",
        label: "View trips",
        permissions: ["trips.read"],
        // trips.read is granted to Member and Pre-Marshall for published trips.
        effective: {
          super_admin: "allowed",
          admin: "allowed",
          marshall: "allowed",
          pre_marshall: "allowed",
          member: "allowed",
        },
      },
      {
        id: "trips.create",
        label: "Create trips",
        permissions: ["trips.create"],
      },
      {
        id: "trips.edit_own",
        label: "Edit own trips",
        permissions: ["trips.manage_own", "trips.manage"],
        effective: {
          super_admin: "allowed",
          admin: "allowed",
          marshall: "own_drives",
          pre_marshall: "not_allowed",
          member: "not_allowed",
        },
      },
      {
        id: "trips.cancel_own",
        label: "Cancel own trips",
        permissions: ["trips.manage_own", "trips.manage"],
        effective: {
          super_admin: "allowed",
          admin: "allowed",
          marshall: "own_drives",
          pre_marshall: "not_allowed",
          member: "not_allowed",
        },
      },
      {
        id: "trips.delete_own",
        label: "Permanently delete own trips",
        permissions: ["trips.manage", "trips.manage_own", "trips.create"],
        effective: {
          super_admin: "allowed",
          admin: "allowed",
          marshall: "own_drives",
          pre_marshall: "not_allowed",
          member: "not_allowed",
        },
      },
      {
        id: "trips.manage_all",
        label: "Manage all trips",
        permissions: ["trips.manage"],
      },
    ],
  },
  {
    id: "participants",
    label: "Participants",
    activities: [
      {
        id: "participants.view",
        label: "View participants",
        permissions: ["trips.read", "members.read", "registrations.manage"],
        effective: {
          super_admin: "allowed",
          admin: "allowed",
          marshall: "own_drives",
          pre_marshall: "assigned_drives",
          member: "not_allowed",
        },
      },
      {
        id: "registrations.manage",
        label: "Manage registrations",
        permissions: ["registrations.manage"],
      },
      {
        id: "attendance.mark",
        label: "Mark attendance",
        // Pre-Marshall has attendance.mark in seed, but service requires organizer/admin.
        permissions: ["attendance.mark", "trips.manage_own", "trips.manage"],
        effective: {
          super_admin: "allowed",
          admin: "allowed",
          marshall: "own_drives",
          pre_marshall: "not_allowed",
          member: "not_allowed",
        },
      },
      {
        id: "attendance.history",
        label: "View attendance history",
        permissions: ["attendance.mark", "trips.manage", "trips.read"],
        effective: {
          super_admin: "allowed",
          admin: "allowed",
          marshall: "own_drives",
          pre_marshall: "assigned_drives",
          member: "not_allowed",
        },
      },
    ],
  },
  {
    id: "ratings",
    label: "Ratings & membership",
    activities: [
      {
        id: "ratings.create",
        label: "Rate eligible members",
        permissions: ["ratings.create"],
        effective: {
          super_admin: "allowed",
          admin: "allowed",
          marshall: "own_drives",
          pre_marshall: "not_allowed",
          member: "not_allowed",
        },
      },
      {
        id: "upgrades.recommend",
        label: "Recommend membership upgrades",
        permissions: ["upgrades.recommend"],
      },
      {
        id: "upgrades.review",
        label: "Approve/reject upgrades",
        permissions: ["upgrades.review"],
      },
      {
        id: "ratings.correct",
        label: "Correct rating records",
        // Enforced via upgrades.review or trips.manage in ratingService.correctRating
        permissions: ["upgrades.review", "trips.manage"],
        effective: {
          super_admin: "allowed",
          admin: "allowed",
          marshall: "not_allowed",
          pre_marshall: "not_allowed",
          member: "not_allowed",
        },
      },
    ],
  },
  {
    id: "team",
    label: "Team management",
    activities: [
      {
        id: "members.view",
        label: "View members",
        permissions: ["members.read"],
      },
      {
        id: "members.approve",
        label: "Approve/reject members",
        permissions: ["members.manage"],
      },
      {
        id: "roles.assign_marshall",
        label: "Assign Marshall roles",
        permissions: ["roles.assign"],
      },
      {
        id: "roles.assign_pre_marshall",
        label: "Assign Pre-Marshall roles",
        permissions: ["roles.assign"],
      },
      {
        id: "roles.remove",
        label: "Remove roles",
        permissions: ["roles.assign"],
      },
      {
        id: "members.deactivate",
        label: "Deactivate accounts",
        permissions: ["members.manage"],
      },
      {
        id: "members.permanent_delete",
        label: "Permanently delete accounts",
        permissions: ["members.manage"],
      },
    ],
  },
];

export const ACCESS_LABELS: Record<AccessLevel, string> = {
  allowed: "Allowed",
  own_drives: "Own drives only",
  assigned_drives: "Assigned drives only",
  not_allowed: "Not allowed",
  unavailable: "Unavailable",
};

export function roleDisplayName(code: string): string {
  if (code in ROLE_META) return ROLE_META[code as RoleCode].name;
  return code
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function hasAny(perms: Set<string>, codes?: string[]) {
  if (!codes || codes.length === 0) return false;
  return codes.some((c) => perms.has(c));
}

/**
 * Resolve matrix cell from API grants + effective overrides.
 * Never marks Allowed unless the role actually has enabling permissions
 * (or an explicit effective override that matches backend behaviour).
 */
export function resolveAccess(
  roleCode: RoleCode,
  activity: MatrixActivity,
  permissionsByRole: Record<string, string[]>,
): AccessLevel {
  if (activity.effective && activity.effective[roleCode] !== undefined) {
    return activity.effective[roleCode]!;
  }

  const perms = new Set(permissionsByRole[roleCode] || []);
  if (!activity.permissions || activity.permissions.length === 0) {
    return "unavailable";
  }

  if (roleCode === "super_admin" || roleCode === "admin") {
    return hasAny(perms, activity.permissions) ? "allowed" : "not_allowed";
  }

  if (hasAny(perms, activity.permissions)) {
    if (activity.permissions.includes("trips.manage_own") && perms.has("trips.manage_own")) {
      return "own_drives";
    }
    return "allowed";
  }

  return "not_allowed";
}

export function allowedActivitiesForRole(
  roleCode: RoleCode,
  permissionsByRole: Record<string, string[]>,
): string[] {
  const allowed: string[] = [];
  for (const category of MATRIX_CATEGORIES) {
    for (const activity of category.activities) {
      const level = resolveAccess(roleCode, activity, permissionsByRole);
      if (level === "not_allowed" || level === "unavailable") continue;
      const scope =
        level === "allowed" ? "" : ` (${ACCESS_LABELS[level].toLowerCase()})`;
      allowed.push(`${activity.label}${scope}`);
    }
  }
  return allowed;
}

export function restrictedActivitiesForRole(
  roleCode: RoleCode,
  permissionsByRole: Record<string, string[]>,
): string[] {
  const restricted: string[] = [];
  for (const category of MATRIX_CATEGORIES) {
    for (const activity of category.activities) {
      const level = resolveAccess(roleCode, activity, permissionsByRole);
      if (level === "not_allowed" || level === "unavailable") {
        restricted.push(activity.label);
      }
    }
  }
  return restricted;
}

export function adminAssignableRoles(actorRoles: string[]): RoleCode[] {
  const isSuper = actorRoles.includes("super_admin");
  const isAdmin = isSuper || actorRoles.includes("admin");
  if (!isAdmin) return [];
  const base: RoleCode[] = ["member", "pre_marshall", "marshall"];
  if (isSuper) return [...base, "admin", "super_admin"];
  return base;
}
