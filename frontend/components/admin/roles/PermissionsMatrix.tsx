"use client";

import { Fragment, useState } from "react";
import {
  MATRIX_CATEGORIES,
  ROLE_META,
  ROLE_ORDER,
  resolveAccess,
  type RoleCode,
} from "@/lib/rolesCatalog";
import { AccessBadge } from "./AccessBadge";

export function PermissionsMatrix({
  permissionsByRole,
  canToggleTechnical,
}: {
  permissionsByRole: Record<string, string[]>;
  canToggleTechnical: boolean;
}) {
  const [tech, setTech] = useState(false);

  return (
    <section className="mb-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display m-0 text-2xl">Who can do what</h2>
          <p className="mt-1 mb-0 text-sm text-[var(--keepers-muted)]">
            Plain-language comparison mapped to live role grants. Scoped labels
            match backend restrictions (own drives / assigned drives).
          </p>
        </div>
        {canToggleTechnical ? (
          <label className="flex items-center gap-2 text-sm text-[var(--keepers-muted)]">
            <input
              type="checkbox"
              checked={tech}
              onChange={(e) => setTech(e.target.checked)}
            />
            Technical codes
          </label>
        ) : null}
      </div>

      <div className="panel overflow-x-auto p-0">
        <table className="admin-table role-matrix-table">
          <thead>
            <tr>
              <th className="min-w-[14rem]">Activity</th>
              {ROLE_ORDER.map((code) => (
                <th key={code} className="min-w-[8.5rem]">
                  {ROLE_META[code].name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MATRIX_CATEGORIES.map((category) => (
              <Fragment key={category.id}>
                <tr className="role-matrix-category">
                  <td colSpan={ROLE_ORDER.length + 1}>{category.label}</td>
                </tr>
                {category.activities.map((activity) => (
                  <tr key={activity.id}>
                    <td>
                      <div className="font-medium text-[var(--keepers-ink)]">
                        {activity.label}
                      </div>
                      {tech && activity.permissions?.length ? (
                        <div className="mt-1 font-mono text-[0.68rem] text-[var(--keepers-muted)]">
                          {activity.permissions.join(" · ")}
                        </div>
                      ) : null}
                    </td>
                    {ROLE_ORDER.map((code) => {
                      const level = resolveAccess(
                        code as RoleCode,
                        activity,
                        permissionsByRole,
                      );
                      return (
                        <td key={`${activity.id}-${code}`}>
                          <AccessBadge level={level} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
