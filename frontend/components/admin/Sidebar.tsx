"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { BrandLogo } from "@/components/BrandLogo";

const NAV_GROUPS = [
  {
    label: "Overview",
    items: [{ href: "/dashboard", label: "Dashboard" }],
  },
  {
    label: "People",
    items: [
      { href: "/members", label: "Members" },
      { href: "/marshalls", label: "Marshalls" },
      { href: "/progression", label: "Driver Progression" },
      { href: "/roles", label: "Role management" },
      { href: "/ratings", label: "Ratings" },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/trips", label: "Trips" },
      { href: "/calendar", label: "Calendar" },
      { href: "/registrations", label: "Registrations" },
      { href: "/events", label: "Events" },
      { href: "/chat", label: "Communication" },
    ],
  },
  {
    label: "Content",
    items: [
      { href: "/carousel", label: "Carousel" },
      { href: "/gallery", label: "Gallery" },
      { href: "/media", label: "Media" },
      { href: "/sponsors", label: "Sponsors" },
      { href: "/announcements", label: "Announcements" },
      { href: "/documents", label: "Documents" },
    ],
  },
  {
    label: "System",
    items: [{ href: "/settings", label: "Settings" }],
  },
];

export function Sidebar({
  collapsed,
  mobileOpen,
  onToggleCollapse,
  onCloseMobile,
}: {
  collapsed: boolean;
  mobileOpen: boolean;
  onToggleCollapse: () => void;
  onCloseMobile: () => void;
}) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const display =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.email ||
    "Administrator";

  return (
    <aside
      className={[
        "z-50 flex h-screen shrink-0 flex-col bg-keepers-black text-keepers-ivory transition-[width,transform] duration-200",
        "fixed inset-y-0 left-0 w-[260px] lg:sticky lg:top-0",
        collapsed ? "lg:w-[72px]" : "lg:w-[240px]",
        mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2 border-b border-white/10 px-4 py-5">
        <div className="min-w-0">
          {collapsed ? (
            <div className="w-10 overflow-hidden">
              <BrandLogo tone="dark" height={20} />
            </div>
          ) : (
            <>
              <BrandLogo tone="dark" height={28} />
              <p className="mt-2 text-[0.65rem] tracking-[0.22em] uppercase text-keepers-stone">
                Admin
              </p>
            </>
          )}
        </div>
        <button
          type="button"
          className="btn btn-ghost hidden px-2 text-keepers-stone lg:inline-flex"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? "»" : "«"}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            {!collapsed ? (
              <p className="mx-2 mt-4 mb-1 px-2 text-[0.62rem] tracking-[0.16em] uppercase text-keepers-stone">
                {group.label}
              </p>
            ) : (
              <div className="mt-3" />
            )}
            <ul className="m-0 list-none space-y-0.5 p-0">
              {group.items.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      title={item.label}
                      onClick={onCloseMobile}
                      className={`block truncate px-3 py-2.5 text-[0.78rem] tracking-[0.08em] uppercase transition-colors ${
                        active
                          ? "bg-white/10 text-keepers-ivory"
                          : "text-keepers-stone hover:bg-white/5 hover:text-keepers-ivory"
                      }`}
                    >
                      {collapsed ? item.label.charAt(0) : item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 px-4 py-4">
        {!collapsed ? (
          <div>
            <p className="truncate text-sm text-keepers-ivory">{display}</p>
            <p className="mt-1 truncate text-xs text-keepers-stone">{user?.email}</p>
          </div>
        ) : null}
        <button
          type="button"
          className="btn btn-ghost mt-3 px-0 text-keepers-stone"
          onClick={logout}
          title="Sign out"
        >
          {collapsed ? "Out" : "Sign out"}
        </button>
      </div>
    </aside>
  );
}
