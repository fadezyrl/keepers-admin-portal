"use client";

import { AuthProvider } from "@/lib/auth";
import { ToastProvider } from "@/lib/toast";
import { QueryProvider } from "@/components/providers/QueryProvider";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <AuthProvider>
        <ToastProvider>{children}</ToastProvider>
      </AuthProvider>
    </QueryProvider>
  );
}
