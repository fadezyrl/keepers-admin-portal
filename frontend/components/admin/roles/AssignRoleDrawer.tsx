"use client";

import { useMemo, useState } from "react";
import { api, ApiError, buildQuery } from "@/lib/api";
import { useAdminQuery } from "@/lib/useAdminQuery";
import { queryKeys, stale } from "@/lib/queryKeys";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import type { Member, Paginated } from "@/lib/types";
import {
  ROLE_META,
  adminAssignableRoles,
  roleDisplayName,
  type RoleCode,
} from "@/lib/rolesCatalog";
import { Drawer } from "@/components/ui/Drawer";
import { FormField } from "@/components/ui/FormField";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

export function AssignRoleDrawer({
  open,
  onClose,
  actorRoles,
  initialMember,
  initialRole,
  mode = "assign",
  onCompleted,
}: {
  open: boolean;
  onClose: () => void;
  actorRoles: string[];
  initialMember?: Member | null;
  initialRole?: RoleCode | null;
  mode?: "assign" | "remove";
  onCompleted: () => Promise<void> | void;
}) {
  const assignable = useMemo(() => adminAssignableRoles(actorRoles), [actorRoles]);
  const [pickerQ, setPickerQ] = useState(initialMember?.name || "");
  const debouncedPickerQ = useDebouncedValue(pickerQ, 300);
  const [selectedMember, setSelectedMember] = useState<Member | null>(
    initialMember || null,
  );
  const [role, setRole] = useState<RoleCode>(
    initialRole && assignable.includes(initialRole)
      ? initialRole
      : assignable[0] || "marshall",
  );
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickerParams = useMemo(
    () => ({
      q: debouncedPickerQ.trim() || undefined,
      status: "approved",
      limit: 8,
    }),
    [debouncedPickerQ],
  );

  const pickerQuery = useAdminQuery(
    queryKeys.members.list(pickerParams),
    (signal) =>
      debouncedPickerQ.trim().length < 2
        ? Promise.resolve({
            items: [],
            pagination: { page: 1, limit: 8, total: 0 },
          } as Paginated<Member>)
        : api.get<Paginated<Member>>(`/members${buildQuery(pickerParams)}`, {
            signal,
          }),
    { staleTime: stale.operational, enabled: open && !initialMember },
  );

  const meta = ROLE_META[role];
  const currentRoles = (selectedMember?.roles || []).map((r) => r.code);
  const alreadyHas = currentRoles.includes(role);

  async function runAction() {
    if (!selectedMember) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "remove") {
        await api.delete(`/members/${selectedMember.id}/roles/${role}`);
      } else {
        await api.post(`/members/${selectedMember.id}/roles`, { role });
      }
      setConfirmOpen(false);
      await onCompleted();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Role update failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title={mode === "remove" ? "Remove role" : "Assign role"}
        subtitle="Search a member, review the access change, then confirm."
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className={mode === "remove" ? "btn btn-danger" : "btn btn-primary"}
              disabled={!selectedMember || (mode === "assign" && alreadyHas)}
              onClick={() => setConfirmOpen(true)}
            >
              {mode === "remove" ? "Continue to remove" : "Continue to assign"}
            </button>
          </>
        }
      >
        <div className="space-y-5">
          {!initialMember ? (
            <div>
              <FormField label="Find member">
                <input
                  className="admin-input"
                  value={pickerQ}
                  onChange={(e) => {
                    setPickerQ(e.target.value);
                    setSelectedMember(null);
                  }}
                  placeholder="Search name, email, username…"
                />
              </FormField>
              {selectedMember ? (
                <p className="mt-2 mb-0 text-sm">
                  Selected: <strong>{selectedMember.name}</strong> (@
                  {selectedMember.username})
                </p>
              ) : null}
              {debouncedPickerQ.trim().length >= 2 && !selectedMember ? (
                <ul className="mt-2 m-0 max-h-48 list-none overflow-y-auto border border-[var(--keepers-line)] p-0">
                  {(pickerQuery.data?.items || []).map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--keepers-cream)]"
                        onClick={() => {
                          setSelectedMember(m);
                          setPickerQ(m.name);
                        }}
                      >
                        {m.name}
                        <span className="text-[var(--keepers-muted)]">
                          {" "}
                          · @{m.username}
                        </span>
                      </button>
                    </li>
                  ))}
                  {!pickerQuery.loading &&
                  (pickerQuery.data?.items || []).length === 0 ? (
                    <li className="px-3 py-2 text-sm text-[var(--keepers-muted)]">
                      No matches
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </div>
          ) : (
            <div className="rounded-sm bg-[var(--keepers-cream)] px-3 py-3 text-sm">
              <div className="font-medium">{initialMember.name}</div>
              <div className="text-[var(--keepers-muted)]">
                @{initialMember.username} · {initialMember.email}
              </div>
              <div className="mt-2 text-[var(--keepers-muted)]">
                Current roles:{" "}
                {currentRoles.length
                  ? currentRoles.map(roleDisplayName).join(", ")
                  : "None"}
              </div>
            </div>
          )}

          <FormField label={mode === "remove" ? "Role to remove" : "Role to add"}>
            <select
              className="admin-select"
              value={role}
              onChange={(e) => setRole(e.target.value as RoleCode)}
            >
              {assignable.map((code) => (
                <option key={code} value={code}>
                  {ROLE_META[code].name}
                </option>
              ))}
            </select>
          </FormField>

          {mode === "assign" ? (
            <div className="border border-[var(--keepers-line)] bg-[var(--keepers-ivory)] p-4">
              <p className="m-0 text-[0.65rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
                Access they will receive
              </p>
              <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--keepers-ink)]">
                {meta.shortDescription}
              </p>
              <ul className="mt-3 mb-0 list-none space-y-2 p-0">
                {meta.accessGains.map((gain) => (
                  <li
                    key={gain}
                    className="border-l border-[var(--keepers-line-strong)] pl-3 text-sm"
                  >
                    {gain}
                  </li>
                ))}
              </ul>
              {role === "marshall" || role === "pre_marshall" ? (
                <p className="mt-3 mb-0 text-sm text-[var(--keepers-muted)]">
                  Their existing Member access stays in place. This role is added
                  alongside it.
                </p>
              ) : null}
              {alreadyHas ? (
                <p className="mt-3 mb-0 text-sm text-[var(--keepers-warn)]">
                  This member already has the {meta.name} role.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="border border-[var(--keepers-line)] bg-[var(--keepers-ivory)] p-4">
              <p className="m-0 text-sm leading-relaxed">
                Removing <strong>{meta.name}</strong> will revoke the additional
                access listed for that role. Backend safeguards still block
                removing the last Admin / Super Admin.
              </p>
            </div>
          )}

          {error ? (
            <p className="m-0 text-sm text-[var(--keepers-danger)]">{error}</p>
          ) : null}
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirmOpen}
        title={
          mode === "remove"
            ? `Remove ${meta.name}?`
            : `Assign ${meta.name}?`
        }
        tone={mode === "remove" ? "danger" : "primary"}
        confirmLabel={mode === "remove" ? "Remove role" : "Assign role"}
        busy={busy}
        onClose={() => !busy && setConfirmOpen(false)}
        onConfirm={() => void runAction()}
        description={
          selectedMember ? (
            <div>
              <p className="m-0">
                {mode === "remove" ? "Remove" : "Add"}{" "}
                <strong>{meta.name}</strong>{" "}
                {mode === "remove" ? "from" : "for"}{" "}
                <strong>{selectedMember.name}</strong>.
              </p>
              {mode === "assign" ? (
                <ul className="mt-3 mb-0 list-none space-y-1.5 p-0">
                  {meta.accessGains.slice(0, 4).map((gain) => (
                    <li key={gain} className="text-sm">
                      • {gain}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : undefined
        }
      />
    </>
  );
}
