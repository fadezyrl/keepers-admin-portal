"use client";

import { useEffect, useMemo, useState } from "react";

const APP_DEEP_LINK = "keepers://auth/reset-password";

function buildAppUrl(params: URLSearchParams) {
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  const type = params.get("type") || "recovery";
  const error = params.get("error");
  const errorDescription = params.get("error_description");

  const next = new URLSearchParams();
  if (accessToken) next.set("access_token", accessToken);
  if (refreshToken) next.set("refresh_token", refreshToken);
  if (type) next.set("type", type);
  if (error) next.set("error", error);
  if (errorDescription) next.set("error_description", errorDescription);

  const qs = next.toString();
  // Query string (not hash) — Android Intent filters often strip URL fragments.
  return qs ? `${APP_DEEP_LINK}?${qs}` : APP_DEEP_LINK;
}

/**
 * HTTPS bridge for Supabase password-recovery emails.
 * Supabase redirects here with tokens in the hash; we forward them into the
 * Keepers app via keepers://…?access_token=… so the mobile deep link works.
 */
export default function MobileResetBridgePage() {
  const [status, setStatus] = useState<"opening" | "ready" | "error">("opening");
  const [message, setMessage] = useState("Opening the Keepers app…");
  const [appUrl, setAppUrl] = useState(APP_DEEP_LINK);

  const title = useMemo(() => {
    if (status === "error") return "Reset link issue";
    if (status === "ready") return "Open Keepers";
    return "Reset password";
  }, [status]);

  useEffect(() => {
    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash || "";
    const fromHash = new URLSearchParams(hash);
    const fromQuery = new URLSearchParams(window.location.search);
    const merged = new URLSearchParams();

    for (const key of [
      "access_token",
      "refresh_token",
      "type",
      "error",
      "error_description",
      "error_code",
    ]) {
      const value = fromHash.get(key) || fromQuery.get(key);
      if (value) merged.set(key, value);
    }

    if (merged.get("error")) {
      setStatus("error");
      setMessage(
        merged.get("error_description") ||
          "This reset link is invalid or has expired. Request a new one from the app.",
      );
      return;
    }

    if (!merged.get("access_token")) {
      setStatus("error");
      setMessage(
        "No reset token was found. Open the latest reset email on your phone and tap the link again.",
      );
      return;
    }

    const deepLink = buildAppUrl(merged);
    setAppUrl(deepLink);
    setStatus("ready");
    setMessage("Continue in the Keepers app to choose a new password.");

    // Auto-open the app; keep a manual button if the browser blocks it.
    window.location.href = deepLink;
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        background: "#111110",
        color: "#F3F0EA",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
      }}
    >
      <div style={{ maxWidth: 420, width: "100%", textAlign: "center" }}>
        <p
          style={{
            margin: 0,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            fontSize: 11,
            color: "#A9A49B",
          }}
        >
          Keepers Adventures
        </p>
        <h1
          style={{
            margin: "1rem 0 0.75rem",
            fontSize: "2rem",
            fontWeight: 500,
            lineHeight: 1.15,
          }}
        >
          {title}
        </h1>
        <p style={{ margin: 0, color: "#D2CEC6", lineHeight: 1.55 }}>{message}</p>

        {status !== "error" ? (
          <a
            href={appUrl}
            style={{
              display: "inline-block",
              marginTop: "1.75rem",
              padding: "0.9rem 1.25rem",
              background: "#F3F0EA",
              color: "#111110",
              textDecoration: "none",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Open Keepers app
          </a>
        ) : null}
      </div>
    </main>
  );
}
