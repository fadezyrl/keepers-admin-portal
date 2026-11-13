"use client";

import type { Member } from "@/lib/types";
import {
  ROLE_META,
  allowedActivitiesForRole,
  roleDisplayName,
  type RoleCode,
} from "@/lib/rolesCatalog";
import { Drawer } from "@/components/ui/Drawer";

export function MemberPermissionsDrawer({
  member,
  open,
  permissionsByRole,
  onClose,
  onOpenProfile,
}: {
  member: Member | null;
  open: boolean;
  permissionsByRole: Record<string, string[]>;
  onClose: () => void;
  onOpenProfile: () => void;
}) {
  const codes = (member?.roles || []).map((r) => r.code);
  const activities = new Set<string>();
  for (const code of codes) {
    if (!(code in ROLE_META)) continue;
    for (const label of allowedActivitiesForRole(
      code as RoleCode,
      permissionsByRole,
    )) {
      activities.add(label);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={member?.name || "Permissions"}
      subtitle={
        member
          ? `Effective access from: ${
              codes.length ? codes.map(roleDisplayName).join(", ") : "no roles"
            }`
          : undefined
      }
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn-primary" onClick={onOpenProfile}>
            View profile
          </button>
        </>
      }
    >
      {!member ? null : (
        <div className="space-y-6">
          <section>
            <h3 className="font-display m-0 text-lg">Current roles</h3>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {codes.length ? (
                codes.map((code) => (
                  <span key={code} className="role-chip">
                    {roleDisplayName(code)}
                  </span>
                ))
              ) : (
                <span className="text-sm text-[var(--keepers-muted)]">None</span>
              )}
            </div>
          </section>

          <section>
            <h3 className="font-display m-0 text-lg">What they can do</h3>
            <ul className="mt-3 mb-0 list-none space-y-2 p-0">
              {[...activities].map((item) => (
                <li
                  key={item}
                  className="border-l border-[var(--keepers-line-strong)] pl-3 text-sm"
                >
                  {item}
                </li>
              ))}
              {activities.size === 0 ? (
                <li className="text-sm text-[var(--keepers-muted)]">
                  No elevated activities from current roles.
                </li>
              ) : null}
            </ul>
          </section>

          {codes.map((code) => {
            if (!(code in ROLE_META)) return null;
            const meta = ROLE_META[code as RoleCode];
            return (
              <section key={code}>
                <h3 className="font-display m-0 text-lg">{meta.name}</h3>
                <p className="mt-2 mb-0 text-sm text-[var(--keepers-muted)]">
                  {meta.shortDescription}
                </p>
              </section>
            );
          })}
        </div>
      )}
    </Drawer>
  );
}
