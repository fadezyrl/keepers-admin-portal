"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/members", label: "Members" },
  { href: "/marshalls", label: "Marshalls" },
  { href: "/trips", label: "Trips" },
  { href: "/calendar", label: "Calendar" },
  { href: "/registrations", label: "Registrations" },
  { href: "/ratings", label: "Ratings" },
  { href: "/media", label: "Media" },
  { href: "/sponsors", label: "Sponsors" },
  { href: "/announcements", label: "Announcements" },
  { href: "/documents", label: "Documents" },
  { href: "/settings", label: "Settings" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const display =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.email ||
    "Administrator";

  return (
    <aside className="flex min-h-screen w-[240px] shrink-0 flex-col bg-[var(--sidebar)] text-[var(--sidebar-fg)]">
      <div className="border-b border-white/10 px-6 py-7">
        <p className="text-[0.65rem] tracking-[0.22em] uppercase text-[var(--keepers-stone)]">
          Keepers Adventures
        </p>
        <p className="font-display mt-2 text-3xl leading-none tracking-tight">Admin</p>
      </div>

      <nav className="flex-1 px-3 py-5">
        <ul className="m-0 list-none space-y-0.5 p-0">
          {NAV.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`block px-3 py-2.5 text-[0.8rem] tracking-[0.08em] uppercase transition-colors ${
                    active
                      ? "bg-white/10 text-[var(--keepers-ivory)]"
                      : "text-[var(--keepers-stone)] hover:bg-white/5 hover:text-[var(--keepers-ivory)]"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-white/10 px-6 py-5">
        <p className="truncate text-sm text-[var(--keepers-ivory)]">{display}</p>
        <p className="mt-1 truncate text-xs text-[var(--keepers-stone)]">{user?.email}</p>
        <button type="button" className="btn btn-ghost mt-4 px-0 text-[var(--keepers-stone)]" onClick={logout}>
          Sign out
        </button>
      </div>
    </aside>
  );
}
