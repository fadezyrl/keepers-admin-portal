import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — Keepers Adventures",
  description:
    "Privacy Policy for the Keepers Adventures mobile app and membership services.",
  robots: { index: true, follow: true },
};

const PRIVACY_EMAIL = "hello@keepersadventures.ae";

/**
 * Public Privacy Policy for App Store / Play Store (no auth).
 * Privacy URL: https://keepers-admin-portal.vercel.app/privacy-policy
 */
export default function PrivacyPolicyPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "2.5rem 1.5rem 4rem",
        background: "#111110",
        color: "#F3F0EA",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
      }}
    >
      <article style={{ maxWidth: 640, margin: "0 auto" }}>
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
            margin: "1rem 0 0.5rem",
            fontSize: "2.25rem",
            fontWeight: 500,
            lineHeight: 1.15,
            fontFamily: "var(--font-cormorant), Georgia, serif",
          }}
        >
          Privacy Policy
        </h1>
        <p style={{ margin: 0, color: "#A9A49B", fontSize: 14 }}>
          Last updated: 23 November 2026
        </p>

        <Section title="Overview">
          Keepers Adventures 4x4 respects member privacy. This policy explains
          what information we collect in the Keepers Adventures mobile app, why
          we use it, and the choices available to you.
        </Section>

        <Section title="Information we collect">
          We may collect account details (name, email, phone), profile and
          vehicle information you provide, expedition registrations, emergency
          contacts, notification preferences, and basic app settings such as
          display mode. When you use trip chat we process message content and
          media you send (photos, video, voice). Device tokens are used to
          deliver push notifications. Camera, photo library, microphone, and
          calendar access are requested only for features that need them
          (profile/vehicle photos, voice messages, adding trip dates).
        </Section>

        <Section title="How information is used">
          We use your data to authenticate membership, manage trip
          registrations, operate group and private trip chats, send trip and
          club notifications, show the members directory according to your
          privacy settings, and improve expedition safety and club operations.
        </Section>

        <Section title="Sharing">
          We do not sell your personal information. Data may be processed by
          service providers that host our backend, database, file storage, and
          push notification delivery, solely to operate the app. Other members
          may see profile information you choose to share in the directory and
          messages you send in trips you join.
        </Section>

        <Section title="Retention">
          We retain account and trip records while your membership is active and
          as needed for club operations, safety, and legal obligations. Chat and
          media are retained as part of trip communications unless removed under
          club moderation rules or account deletion.
        </Section>

        <Section title="Your choices">
          You may update profile details, notification preferences, and privacy
          controls in the app Settings. You may request account deletion from
          club administration. For privacy requests email{" "}
          <a
            href={`mailto:${PRIVACY_EMAIL}`}
            style={{ color: "#F3F0EA", textUnderlineOffset: 3 }}
          >
            {PRIVACY_EMAIL}
          </a>
          .
        </Section>

        <Section title="Children">
          Keepers Adventures is intended for approved adult club members. We do
          not knowingly collect personal information from children.
        </Section>

        <Section title="Contact">
          Questions about this policy:{" "}
          <a
            href={`mailto:${PRIVACY_EMAIL}`}
            style={{ color: "#F3F0EA", textUnderlineOffset: 3 }}
          >
            {PRIVACY_EMAIL}
          </a>
          . App support:{" "}
          <Link
            href="/support"
            style={{ color: "#F3F0EA", textUnderlineOffset: 3 }}
          >
            Support page
          </Link>
          .
        </Section>
      </article>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section style={{ marginTop: "1.75rem" }}>
      <h2
        style={{
          margin: "0 0 0.5rem",
          fontSize: "1.15rem",
          fontWeight: 600,
          letterSpacing: "0.02em",
        }}
      >
        {title}
      </h2>
      <p style={{ margin: 0, color: "#D2CEC6", lineHeight: 1.65 }}>{children}</p>
    </section>
  );
}
