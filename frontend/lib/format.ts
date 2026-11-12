import { format, parseISO, isValid } from "date-fns";

export function formatDate(value?: string | null, pattern = "dd MMM yyyy") {
  if (!value) return "—";
  const d = typeof value === "string" ? parseISO(value.slice(0, 10)) : value;
  if (!isValid(d)) return value;
  return format(d, pattern);
}

export function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const d = parseISO(value);
  if (!isValid(d)) return value;
  return format(d, "dd MMM yyyy · HH:mm");
}

export function displayName(
  first?: string | null,
  last?: string | null,
  fallback = "—",
) {
  const name = `${first || ""} ${last || ""}`.trim();
  return name || fallback;
}

export function statusLabel(status?: string | null) {
  if (!status) return "—";
  return status.replace(/_/g, " ");
}
