"use client";

import Link from "next/link";
import { FormEvent, Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, buildQuery } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import type { Member, Paginated } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/ui/StateBlock";
import { StatusBadge } from "@/components/ui/StatusBadge";

function MembersInner() {
  const searchParams = useSearchParams();
  const initialStatus = searchParams.get("status") || "";
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [query, setQuery] = useState({ q: "", status: initialStatus });

  const path = useMemo(
    () =>
      `/members${buildQuery({
        q: query.q || undefined,
        status: query.status || undefined,
        limit: 50,
      })}`,
    [query],
  );

  const { data, error, loading } = useAsync(
    () => api.get<Paginated<Member>>(path),
    [path],
  );

  function applyFilters(e: FormEvent) {
    e.preventDefault();
    setQuery({ q: q.trim(), status });
  }

  return (
    <div>
      <PageHeader
        title="Members"
        subtitle="Search the roster, filter by status, and open a profile to approve or assign roles."
      />

      <form onSubmit={applyFilters} className="mb-6 flex flex-wrap gap-3">
        <input
          className="admin-input max-w-sm"
          placeholder="Search name, email, username…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="admin-select max-w-[200px]"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="suspended">Suspended</option>
        </select>
        <button type="submit" className="btn btn-primary">
          Filter
        </button>
      </form>

      {loading ? <LoadingBlock /> : null}
      {error ? <ErrorBlock message={error} /> : null}
      {!loading && !error && data && data.items.length === 0 ? (
        <EmptyBlock
          title="No members found"
          description="Try a different search or status filter."
        />
      ) : null}

      {!loading && !error && data && data.items.length > 0 ? (
        <div className="panel overflow-x-auto">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Status</th>
                <th>Membership</th>
                <th>Roles</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link href={`/members/${m.id}`} className="font-medium hover:underline">
                      {m.name}
                    </Link>
                    <div className="text-sm text-[var(--keepers-muted)]">
                      @{m.username} · {m.email}
                    </div>
                  </td>
                  <td>
                    <StatusBadge status={m.status} />
                  </td>
                  <td>{m.membership || "—"}</td>
                  <td className="text-sm">
                    {(m.roles || []).map((r) => r.name || r.code).join(", ") || "—"}
                  </td>
                  <td>{formatDate(m.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export default function MembersPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <MembersInner />
    </Suspense>
  );
}
