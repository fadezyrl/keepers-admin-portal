"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Sidebar } from "@/components/admin/Sidebar";
import { LoadingBlock } from "@/components/ui/StateBlock";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { token, loading } = useAuth();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!loading && !token) router.replace("/login");
  }, [loading, token, router]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("keepers_admin_sidebar");
      if (stored === "1") setCollapsed(true);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  function toggleCollapse() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("keepers_admin_sidebar", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

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
    <div className="flex min-h-screen bg-keepers-ivory">
      {mobileOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <Sidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onToggleCollapse={toggleCollapse}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-keepers-greige bg-keepers-white px-4 py-3 lg:hidden">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setMobileOpen(true)}
          >
            Menu
          </button>
          <p className="font-display m-0 text-xl">Keepers Admin</p>
        </div>
        <main className="mx-auto w-full max-w-7xl flex-1 px-5 py-7 sm:px-6 lg:px-10 lg:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
