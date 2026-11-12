"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { Alert } from "@/components/ui/Alert";

export default function LoginPage() {
  const { login, token, loading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && token) router.replace("/dashboard");
  }, [loading, token, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      router.replace("/dashboard");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Unable to sign in",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-canvas">
      <section className="relative hidden flex-col justify-between border-r border-white/10 px-12 py-14 md:flex">
        <div>
          <p className="text-[0.7rem] tracking-[0.28em] uppercase text-[var(--keepers-stone)]">
            Keepers Adventures
          </p>
          <h1 className="font-display mt-8 max-w-md text-5xl leading-[1.05] text-[var(--keepers-ivory)]">
            The club desk for routes, members, and marshalls.
          </h1>
        </div>
        <p className="max-w-sm text-sm leading-relaxed text-[var(--keepers-stone)]">
          Premium administration for the Keepers membership — deliberate, quiet,
          and built around the road ahead.
        </p>
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(ellipse at 20% 20%, rgba(243,240,234,0.12), transparent 50%), linear-gradient(160deg, transparent 40%, rgba(162,164,155,0.08))",
          }}
        />
      </section>

      <section className="flex items-center justify-center bg-[var(--keepers-ivory)] px-6 py-16">
        <div className="w-full max-w-md">
          <p className="text-[0.7rem] tracking-[0.22em] uppercase text-[var(--keepers-muted)] md:hidden">
            Keepers Adventures
          </p>
          <h2 className="font-display mt-3 text-4xl text-[var(--keepers-black)]">Sign in</h2>
          <p className="mt-2 text-sm text-[var(--keepers-muted)]">
            Administrator access only.
          </p>

          <form onSubmit={onSubmit} className="mt-10 space-y-5">
            <label className="block">
              <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
                Email
              </span>
              <input
                className="admin-input"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
                Password
              </span>
              <input
                className="admin-input"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>

            {error ? <Alert tone="danger">{error}</Alert> : null}

            <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
              {submitting ? "Signing in…" : "Enter portal"}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
