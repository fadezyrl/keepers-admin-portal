"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Sidebar } from "@/components/admin/Sidebar";
import { LoadingBlock } from "@/components/ui/StateBlock";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { token, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !token) router.replace("/login");
  }, [loading, token, router]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <LoadingBlock label="Preparing workspace…" />
      </main>
    );
  }

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <LoadingBlock label="Redirecting to sign in…" />
      </main>
    );
  }

  return (
    <div className="flex min-h-screen bg-[var(--keepers-ivory)]">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-x-auto">
        <div className="mx-auto max-w-6xl px-6 py-8 lg:px-10 lg:py-10">{children}</div>
      </main>
    </div>
  );
}
