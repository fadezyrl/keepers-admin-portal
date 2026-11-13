"use client";

import type { ReactNode } from "react";

export function FormField({
  label,
  htmlFor,
  error,
  children,
  className = "",
}: {
  label: string;
  htmlFor?: string;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`} htmlFor={htmlFor}>
      <span className="form-label">{label}</span>
      {children}
      {error ? <p className="form-error">{error}</p> : null}
    </label>
  );
}
