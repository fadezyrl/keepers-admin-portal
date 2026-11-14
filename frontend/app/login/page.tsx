"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { Alert } from "@/components/ui/Alert";
import { BrandLogo } from "@/components/BrandLogo";

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
      <section className="relative hidden overflow-hidden border-r border-white/10 md:flex md:flex-col md:justify-between">
        <img
          src="/images/login-hero.jpg"
          alt="Keepers 4x4 adventure"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(17,17,16,0.72) 0%, rgba(17,17,16,0.45) 42%, rgba(17,17,16,0.82) 100%)",
          }}
        />

        <div className="relative z-[1] px-12 py-14">
          <BrandLogo tone="dark" height={40} />
          <h1 className="font-display mt-8 max-w-md text-5xl leading-[1.05] text-[var(--keepers-ivory)]">
            The club desk for routes, members, and marshalls.
          </h1>
        </div>

        <p className="relative z-[1] max-w-sm px-12 pb-14 text-sm leading-relaxed text-[var(--keepers-stone)]">
          Premium administration for the Keepers membership — deliberate, quiet,
          and built around the road ahead.
        </p>
      </section>

      <section className="flex items-center justify-center bg-[var(--keepers-ivory)] px-6 py-16">
        <div className="w-full max-w-md">
          <BrandLogo tone="light" height={36} className="md:hidden" />
          <h2 className="font-display mt-6 text-4xl text-[var(--keepers-black)] md:mt-0">
            Sign in
          </h2>
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
