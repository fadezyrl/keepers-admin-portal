import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Support — Keepers Adventures",
  description:
    "Support contact for the Keepers Adventures mobile app and membership help.",
  robots: { index: true, follow: true },
};

const SUPPORT_EMAIL = "support@keepers.ae";
const INSTAGRAM_URL = "https://www.instagram.com/keepersadventure/";

/**
 * Public App Store / Play Store support landing page (no auth).
 * Support URL: https://keepers-admin-portal.vercel.app/support
 */
export default function SupportPage() {
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
      <div style={{ maxWidth: 520, width: "100%" }}>
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
            fontSize: "2.25rem",
            fontWeight: 500,
            lineHeight: 1.15,
            fontFamily: "var(--font-cormorant), Georgia, serif",
          }}
        >
          App support
        </h1>
        <p style={{ margin: 0, color: "#D2CEC6", lineHeight: 1.6 }}>
          Need help with the Keepers Adventures app, membership approval, trip
          registration, or account access? Contact us and we will get back to
          you within 1–2 business days.
        </p>

        <section
          style={{
            marginTop: "1.75rem",
            padding: "1.25rem",
            border: "1px solid rgba(243,240,234,0.14)",
            background: "rgba(243,240,234,0.04)",
          }}
        >
          <p
            style={{
              margin: 0,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              fontSize: 11,
              color: "#A9A49B",
            }}
          >
            Email
          </p>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            style={{
              display: "inline-block",
              marginTop: "0.5rem",
              color: "#F3F0EA",
              fontSize: "1.125rem",
              textDecoration: "underline",
              textUnderlineOffset: 4,
            }}
          >
            {SUPPORT_EMAIL}
          </a>
          <p style={{ margin: "1rem 0 0", color: "#A9A49B", fontSize: 14 }}>
            Please include your registered email and a short description of the
            issue (login, trips, chat, notifications, etc.).
          </p>
        </section>

        <p style={{ margin: "1.5rem 0 0", color: "#D2CEC6", lineHeight: 1.6 }}>
          You can also reach the club on Instagram:{" "}
          <a
            href={INSTAGRAM_URL}
            target="_blank"
            rel="noreferrer"
            style={{ color: "#F3F0EA", textUnderlineOffset: 3 }}
          >
            @keepersadventure
          </a>
        </p>

        <p style={{ margin: "2rem 0 0", color: "#A9A49B", fontSize: 13 }}>
          This page is for member and App Store support. Admin portal login is
          separate and not required here.
        </p>
      </div>
    </main>
  );
}
