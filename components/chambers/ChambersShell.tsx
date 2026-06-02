"use client";

// ChambersShell — the post-login app shell.
//
// Sticky left sidebar (brand · user + tier · nav · settings/logout) +
// a scrolling content area. Every logged-in view (Cases, PR-bot, …)
// renders inside this so the sidebar is constant and each view is its
// own route. Dark, cool-neutral records-room theme — see theme.ts.

import { useState } from "react";
import Link from "next/link";
import {
  Scale,
  Bot,
  BookOpen,
  Newspaper,
  Settings,
  LogOut,
  Loader2,
} from "lucide-react";
import { authClient } from "@/lib/authClient";
import { CrestSeal } from "@/components/landing/repojury/seals";
import { CH, CH_FOCUS } from "./theme";

export type ChambersNav = "cases" | "pr-bot" | "how" | "news" | "settings";

interface User {
  /** Display name (greeting / avatar initial). */
  name?: string | null;
  /** GitHub handle, shown as @handle when present. */
  username?: string | null;
  /** Human tier label, e.g. "Open case" / "Standing docket". */
  tierName: string;
  /** Whether the tier is paid (drives the brass tier chip). */
  paid?: boolean;
}

interface Props {
  active: ChambersNav;
  user: User;
  children: React.ReactNode;
}

export function ChambersShell({ active, user, children }: Props) {
  return (
    <div className="flex min-h-screen w-full" style={{ background: CH.bg }}>
      {/* Brass gradient def so CrestSeal's url(#brass) fill renders
          outside the marketing RJSurface. */}
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        <defs>
          <linearGradient id="brass" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={CH.brassLight} />
            <stop offset="0.5" stopColor={CH.brass} />
            <stop offset="1" stopColor="#8f6f17" />
          </linearGradient>
        </defs>
      </svg>

      <Sidebar active={active} user={user} />

      <main className="flex-1 min-w-0">
        {/* Fluid up to a ceiling so cases widen with the screen instead of
         *  sitting narrow on large monitors. Tops out at 7xl (matches the
         *  case-detail page, so no width jump on click-through) — wider than
         *  that and the content-left / metadata-right rows read sparse. */}
        <div className="mx-auto w-full max-w-6xl xl:max-w-7xl px-6 sm:px-10 py-10 sm:py-14">
          {children}
        </div>
      </main>
    </div>
  );
}

function Sidebar({ active, user }: { active: ChambersNav; user: User }) {
  const initial = (user.name || user.username || "?").trim().charAt(0).toUpperCase();

  return (
    <aside
      className="sticky top-0 hidden md:flex h-screen w-[256px] flex-none flex-col"
      style={{
        background: CH.sidebar,
        borderRight: `1px solid ${CH.border}`,
      }}
    >
      {/* Brand */}
      <Link
        href="/"
        className="flex items-center gap-2.5 px-5 h-[68px] flex-none"
        style={{ borderBottom: `1px solid ${CH.border}` }}
      >
        <CrestSeal size={26} />
        <span
          className="text-[17px] font-semibold tracking-tight"
          style={{ color: CH.text }}
        >
          <b style={{ fontWeight: 700 }}>Repo</b>Jury
        </span>
      </Link>

      {/* User + tier */}
      <div
        className="flex items-center gap-3 px-5 py-4 flex-none"
        style={{ borderBottom: `1px solid ${CH.border}` }}
      >
        <span
          className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-sm font-semibold"
          style={{
            background: CH.elevated,
            border: `1px solid ${CH.borderStrong}`,
            color: CH.textDim,
          }}
        >
          {initial}
        </span>
        <span className="min-w-0 flex flex-col">
          <span
            className="truncate text-[13.5px] font-medium"
            style={{ color: CH.text }}
          >
            {user.username ? `@${user.username}` : user.name || "Signed in"}
          </span>
          <span
            className="mt-0.5 inline-flex w-fit items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]"
            style={{
              color: user.paid ? CH.brassLight : CH.textDim,
              background: user.paid ? "rgba(201,162,39,0.12)" : CH.elevated,
              border: `1px solid ${user.paid ? "rgba(201,162,39,0.3)" : CH.border}`,
            }}
          >
            {user.tierName}
          </span>
        </span>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-1 px-3 pt-4 pb-6 overflow-y-auto">
        <NavLink href="/" icon={Scale} label="Cases" activeNow={active === "cases"} />
        <NavLink href="/pr-bot" icon={Bot} label="PR-bot" activeNow={active === "pr-bot"} />

        <Divider />

        <NavLink href="/#process" icon={BookOpen} label="How it works" activeNow={active === "how"} />
        <NavLink href="/news" icon={Newspaper} label="News" activeNow={active === "news"} />

        {/* push the account group to the bottom */}
        <div className="flex-1" />

        <Divider />

        <NavLink href="/account" icon={Settings} label="Settings" activeNow={active === "settings"} />
        <LogoutButton />
      </nav>
    </aside>
  );
}

function Divider() {
  return (
    <div className="my-2 h-px" style={{ background: CH.border }} aria-hidden />
  );
}

function NavLink({
  href,
  icon: Icon,
  label,
  activeNow,
}: {
  href: string;
  icon: typeof Scale;
  label: string;
  activeNow: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] transition-colors ${CH_FOCUS}`}
      style={{
        color: activeNow ? CH.text : CH.textDim,
        background: activeNow ? CH.accentSoft : "transparent",
      }}
    >
      {activeNow && (
        <span
          aria-hidden
          className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r"
          style={{ background: CH.accent }}
        />
      )}
      <Icon
        size={16}
        style={{ color: activeNow ? CH.accent : CH.textMuted }}
      />
      <span style={{ fontWeight: activeNow ? 600 : 500 }}>{label}</span>
    </Link>
  );
}

function LogoutButton() {
  const [loading, setLoading] = useState(false);
  async function onLogout() {
    if (loading) return;
    setLoading(true);
    try {
      await authClient.signOut();
    } finally {
      // Hard navigation so all server components re-evaluate auth state.
      window.location.href = "/";
    }
  }
  return (
    <button
      type="button"
      onClick={onLogout}
      disabled={loading}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] font-medium transition-colors ${CH_FOCUS}`}
      style={{ color: CH.textDim }}
    >
      {loading ? (
        <Loader2 size={16} className="animate-spin" style={{ color: CH.textMuted }} />
      ) : (
        <LogOut size={16} style={{ color: CH.textMuted }} />
      )}
      Logout
    </button>
  );
}
