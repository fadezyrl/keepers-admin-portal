"use client";

export function Pagination({
  page,
  limit,
  total,
  itemCount,
  onPageChange,
}: {
  page: number;
  limit: number;
  total?: number;
  itemCount: number;
  onPageChange: (page: number) => void;
}) {
  const hasTotal = typeof total === "number";
  const totalPages = hasTotal ? Math.max(1, Math.ceil(total / limit)) : undefined;
  const from = itemCount === 0 ? 0 : (page - 1) * limit + 1;
  const to = hasTotal
    ? Math.min(page * limit, total)
    : (page - 1) * limit + itemCount;
  const canPrev = page > 1;
  const canNext = hasTotal
    ? page < (totalPages || 1)
    : itemCount >= limit;

  if (!canPrev && !canNext && itemCount === 0) return null;

  return (
    <div className="pagination">
      <p className="m-0">
        {itemCount === 0
          ? "No results"
          : hasTotal
            ? `Showing ${from}–${to} of ${total}`
            : `Showing ${from}–${to}`}
      </p>
      <div className="pagination-controls">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={!canPrev}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </button>
        <span className="px-2 text-sm">
          Page {page}
          {totalPages ? ` of ${totalPages}` : ""}
        </span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={!canNext}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
