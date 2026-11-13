"use client";

import type { ReactNode } from "react";
import { EmptyBlock, ErrorBlock } from "./StateBlock";
import { TableSkeleton } from "./Skeleton";
import { Pagination } from "./Pagination";

export type DataColumn<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  width?: string;
};

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  loading,
  refreshing,
  error,
  emptyTitle = "No results",
  emptyDescription,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onRowClick,
  busyIds,
  page,
  limit,
  total,
  onPageChange,
  toolbar,
  bulkBar,
}: {
  columns: DataColumn<T>[];
  rows: T[];
  loading?: boolean;
  refreshing?: boolean;
  error?: string | null;
  emptyTitle?: string;
  emptyDescription?: string;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onToggleSelectAll?: () => void;
  onRowClick?: (row: T) => void;
  busyIds?: Set<string>;
  page?: number;
  limit?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  toolbar?: ReactNode;
  bulkBar?: ReactNode;
}) {
  const selectable = Boolean(onToggleSelect && selectedIds);
  const allSelected =
    selectable && rows.length > 0 && rows.every((r) => selectedIds!.has(r.id));

  if (loading && rows.length === 0) {
    return (
      <div>
        {toolbar}
        <TableSkeleton rows={6} cols={Math.min(columns.length, 5)} />
      </div>
    );
  }

  if (error && rows.length === 0) {
    return (
      <div>
        {toolbar}
        <ErrorBlock message={error} />
      </div>
    );
  }

  return (
    <div>
      {toolbar}
      {bulkBar}
      {rows.length === 0 ? (
        <EmptyBlock title={emptyTitle} description={emptyDescription} />
      ) : (
        <div className={`panel overflow-x-auto ${refreshing ? "table-refreshing" : ""}`}>
          <table className="admin-table">
            <thead>
              <tr>
                {selectable ? (
                  <th style={{ width: 42 }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      aria-label="Select all"
                      onChange={onToggleSelectAll}
                    />
                  </th>
                ) : null}
                {columns.map((col) => (
                  <th key={col.key} className={col.className} style={col.width ? { width: col.width } : undefined}>
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const selected = selectedIds?.has(row.id);
                const busy = busyIds?.has(row.id);
                return (
                  <tr
                    key={row.id}
                    className={`${onRowClick ? "is-clickable" : ""} ${selected ? "is-selected" : ""} ${busy ? "is-busy" : ""}`}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {selectable ? (
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={Boolean(selected)}
                          aria-label="Select row"
                          onChange={() => onToggleSelect?.(row.id)}
                        />
                      </td>
                    ) : null}
                    {columns.map((col) => (
                      <td key={col.key} className={col.className}>
                        {col.cell(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {page && limit && onPageChange ? (
            <Pagination
              page={page}
              limit={limit}
              total={total}
              itemCount={rows.length}
              onPageChange={onPageChange}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
