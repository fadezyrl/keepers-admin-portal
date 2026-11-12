export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="empty-state" role="status">
      <p className="m-0 text-sm tracking-[0.14em] uppercase">{label}</p>
    </div>
  );
}

export function EmptyBlock({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="empty-state">
      <p className="font-display m-0 text-2xl text-[var(--keepers-black)]">{title}</p>
      {description ? <p className="mt-2 mb-0 text-sm">{description}</p> : null}
    </div>
  );
}

export function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="empty-state border-[rgba(139,58,47,0.35)] text-[var(--keepers-danger)]">
      <p className="m-0 text-sm tracking-[0.08em] uppercase">Error</p>
      <p className="mt-2 mb-0 text-base text-[var(--keepers-ink)]">{message}</p>
    </div>
  );
}
