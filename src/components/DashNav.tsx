"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { post } from "@/lib/client";

const LINKS = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/pay", label: "Blind Pay" },
  { href: "/dashboard/request", label: "Blind Request" },
  { href: "/dashboard/payments", label: "My payments" },
  { href: "/dashboard/receipts", label: "Receipts" },
  { href: "/dashboard/wallet", label: "Wallet & security" },
  { href: "/dashboard/settings", label: "Settings" },
];

export function DashNav({ username, unread }: { username: string | null; unread: number }) {
  const pathname = usePathname();

  /* The menu stores the path it was opened on, not a bare boolean. The dashboard
     layout survives a client-side navigation, so a boolean would return `true`
     after you picked a link and leave the panel open over the page you just
     asked for. Comparing against the current path closes it on navigation with
     no effect and no extra render. */
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath === pathname;

  async function signOut() {
    await post("/api/auth/signout");
    window.location.href = "/";
  }

  return (
    <header className="wrap-shell flex flex-wrap items-center justify-between gap-4 py-5">
      <div className="flex items-center gap-4">
        <Link href="/dashboard" className="wordmark text-[17px] no-underline">
          Blind
        </Link>
        <span className="pill">
          {username ? `@${username}` : "no username yet"}
          {unread > 0 ? <span className="text-safelight">· {unread} new</span> : null}
        </span>
      </div>
      <button
        type="button"
        className="btn btn-ghost !py-2 !px-4 md:hidden"
        onClick={() => setOpenPath((value) => (value === pathname ? null : pathname))}
        aria-expanded={open}
        aria-controls="dashboard-nav"
      >
        {open ? "Close" : "Menu"}
      </button>
      <nav
        id="dashboard-nav"
        className={`${open ? "flex" : "hidden"} w-full flex-wrap items-center gap-2 md:flex md:w-auto`}
      >
        {LINKS.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`pill ${active ? "pill-develop" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              {link.label}
            </Link>
          );
        })}
        <button type="button" className="pill" onClick={signOut}>
          Sign out
        </button>
      </nav>
    </header>
  );
}
