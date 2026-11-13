"use client";

import {
  ROLE_META,
  ROLE_ORDER,
  type RoleCode,
} from "@/lib/rolesCatalog";

export type RoleOverviewItem = {
  code: string;
  name: string;
  description?: string | null;
  memberCount: number;
};

export function RoleOverview({
  roles,
  uniqueMembers,
  onViewDetails,
}: {
  roles: RoleOverviewItem[];
  uniqueMembers: number;
  onViewDetails: (code: RoleCode) => void;
}) {
  const byCode = Object.fromEntries(roles.map((r) => [r.code, r]));

  return (
    <section className="mb-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display m-0 text-2xl">Role overview</h2>
          <p className="mt-1 mb-0 text-sm text-[var(--keepers-muted)]">
            What each role does, and how many people currently hold it.
          </p>
        </div>
        <p className="m-0 text-sm text-[var(--keepers-muted)]">
          <span className="font-medium text-[var(--keepers-ink)]">{uniqueMembers}</span>{" "}
          unique members with at least one role
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {ROLE_ORDER.map((code) => {
          const meta = ROLE_META[code];
          const row = byCode[code];
          const count = row?.memberCount ?? 0;
          return (
            <article
              key={code}
              className="panel flex flex-col p-5"
              data-role={code}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="m-0 text-[0.65rem] tracking-[0.16em] uppercase text-[var(--keepers-muted)]">
                    Role
                  </p>
                  <h3 className="font-display m-0 mt-1 text-xl">{meta.name}</h3>
                </div>
                <div className="text-right">
                  <p className="m-0 text-2xl font-medium leading-none text-[var(--keepers-ink)]">
                    {count}
                  </p>
                  <p className="mt-1 mb-0 text-xs text-[var(--keepers-muted)]">
                    {count === 1 ? "member" : "members"}
                  </p>
                </div>
              </div>

              <p className="mt-3 mb-0 text-sm leading-relaxed text-[var(--keepers-muted)]">
                {meta.shortDescription}
              </p>

              <ul className="mt-4 mb-0 list-none space-y-1.5 p-0">
                {meta.responsibilities.slice(0, 3).map((item) => (
                  <li
                    key={item}
                    className="border-l border-[var(--keepers-line-strong)] pl-3 text-sm text-[var(--keepers-ink)]"
                  >
                    {item}
                  </li>
                ))}
              </ul>

              <div className="mt-5 flex grow items-end">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => onViewDetails(code)}
                >
                  View details
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
