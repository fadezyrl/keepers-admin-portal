import {
  ACCESS_LABELS,
  type AccessLevel,
} from "@/lib/rolesCatalog";

const CLASS_MAP: Record<AccessLevel, string> = {
  allowed: "role-access role-access-allowed",
  own_drives: "role-access role-access-scoped",
  assigned_drives: "role-access role-access-scoped",
  not_allowed: "role-access role-access-denied",
  unavailable: "role-access role-access-unavailable",
};

export function AccessBadge({ level }: { level: AccessLevel }) {
  return <span className={CLASS_MAP[level]}>{ACCESS_LABELS[level]}</span>;
}
