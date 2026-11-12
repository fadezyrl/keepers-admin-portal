import type { ReactNode } from "react";

export function Alert({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "danger" | "success";
  children: ReactNode;
}) {
  const border =
    tone === "danger"
      ? "border-[rgba(139,58,47,0.35)] text-[var(--keepers-danger)]"
      : tone === "success"
        ? "border-[rgba(61,90,69,0.35)] text-[var(--keepers-success)]"
        : "border-[var(--keepers-line-strong)] text-[var(--keepers-ink)]";

  return (
    <div className={`border px-4 py-3 text-sm ${border} bg-[var(--keepers-white)]`}>
      {children}
    </div>
  );
}
