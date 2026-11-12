"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { LoadingBlock } from "@/components/ui/StateBlock";

export default function HomePage() {
  const { token, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(token ? "/dashboard" : "/login");
  }, [loading, token, router]);

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <LoadingBlock label="Opening Keepers Admin…" />
    </main>
  );
}
