"use client";

// ChambersShell — the post-login app shell.
//
// Desktop (md+): a sticky left sidebar (brand · user + tier · nav ·
// settings/logout) + a scrolling content area.
//
// Mobile (< md): the sidebar is hidden; a slim top bar with the brand and a
// hamburger replaces it, opening the same nav as a slide-in drawer. Without
// this, signed-in users on a phone had no way to reach PR-bot, Settings,
// Upgrade, or Log out — the whole signed-in surface was a dead end.
//
// Every logged-in view (Cases, PR-bot, …) renders inside this so the nav is
// constant and each view is its own route. Dark, warm-neutral theme — see
// theme.ts.

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Layers,
  Bot,
  BookOpen,
  Newspaper,
  Settings,
  LogOut,
  Loader2,
  ArrowUpCircle,
  Menu,
  X,
} from "lucide-react";
import { authClient } from "@/lib/authClient";
import { CH, CH_FOCUS } from "./theme";

export type ChambersNav = "cases" | "pr-bot" | "how" | "news" | "settings";

interface User {
  /** Display name (greeting / avatar initial). */
  name?: string | null;
  /** GitHub handle, shown as @handle when present. */
  username?: string | null;
  /** Human tier label, e.g. "Free" / "Plus". */
  tierName: string;
  /** Whether the tier is paid (drives the brass tier chip). */
  paid?: boolean;
}

interface Props {
  /** Which nav item is current. Optional — when omitted (the normal case
   *  inside the workspace layout) it's derived from the URL, so the sidebar
   *  highlights correctly without each page passing it. The mockup passes it
   *  explicitly since its path doesn't match a real workspace route. */
  active?: ChambersNav;
  user: User;
  children: React.ReactNode;
}

/** Map a workspace pathname to the active nav item. */
function navFromPath(pathname: string): ChambersNav {
  if (pathname.startsWith("/pr-bot")) return "pr-bot";
  if (pathname.startsWith("/news")) return "news";
  if (pathname.startsWith("/how-it-works")) return "how";
  if (pathname.startsWith("/account")) return "settings";
  return "cases";
}

export function ChambersShell({ active, user, children }: Props) {
  const pathname = usePathname();
  const current = active ?? navFromPath(pathname);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the drawer whenever the route changes (a nav tap navigates).
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  return (
    <div className="flex min-h-screen w-full" style={{ background: CH.bg }}>
      {/* Desktop sidebar — unchanged from the original layout. */}
      <aside
        className="sticky top-0 hidden md:flex h-screen w-[256px] flex-none flex-col"
        style={{
          background: CH.sidebar,
          borderRight: `1px solid ${CH.border}`,
        }}
      >
        <SidebarContent active={current} user={user} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar — only below md, where the sidebar is hidden. */}
        <MobileTopBar onOpen={() => setDrawerOpen(true)} />

        <main className="flex-1 min-w-0">
          {/* Fluid up to a ceiling so cases widen with the screen instead of
           *  sitting narrow on large monitors. Tops out at 7xl (matches the
           *  case-detail page, so no width jump on click-through). */}
          <div className="mx-auto w-full max-w-6xl xl:max-w-7xl px-6 sm:px-10 py-10 sm:py-14">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile drawer — the full sidebar nav, slid in over the content. */}
      {drawerOpen && (
        <MobileDrawer
          active={current}
          user={user}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </div>
  );
}

/** The brand + user + nav block, shared by the desktop sidebar and the
 *  mobile drawer. `onNavigate` (drawer only) closes the drawer on a tap. */
function SidebarContent({
  active,
  user,
  onNavigate,
}: {
  active: ChambersNav;
  user: User;
  onNavigate?: () => void;
}) {
  const initial = (user.name || user.username || "?")
    .trim()
    .charAt(0)
    .toUpperCase();

  return (
    <>
      {/* Brand */}
      <Link
        href="/cases"
        onClick={onNavigate}
        className="flex items-center px-5 h-[68px] flex-none"
        style={{ borderBottom: `1px solid ${CH.border}` }}
      >
        <span
          className="text-[18px] font-semibold tracking-tight"
          style={{ color: CH.text, letterSpacing: "-0.02em" }}
        >
          CodeTrawl
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
              color: user.paid ? CH.text : CH.textDim,
              background: CH.elevated,
              border: `1px solid ${CH.border}`,
            }}
          >
            {user.tierName}
          </span>
        </span>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-1 px-3 pt-4 pb-6 overflow-y-auto">
        <NavLink href="/cases" icon={Layers} label="Surveys" activeNow={active === "cases"} onNavigate={onNavigate} />
        <NavLink href="/pr-bot" icon={Bot} label="PR-bot" activeNow={active === "pr-bot"} onNavigate={onNavigate} />

        <Divider />

        <NavLink href="/how-it-works" icon={BookOpen} label="How it works" activeNow={active === "how"} onNavigate={onNavigate} />
        <NavLink href="/news" icon={Newspaper} label="News" activeNow={active === "news"} onNavigate={onNavigate} />

        {/* Upgrade — only for free tiers. Unlike the others this leaves the
            workspace for /pricing (marketing + checkout), so it's never an
            "active" workspace route; it reads as a plain destination link. */}
        {!user.paid && (
          <NavLink href="/pricing" icon={ArrowUpCircle} label="Upgrade" activeNow={false} onNavigate={onNavigate} />
        )}

        {/* push the account group to the bottom */}
        <div className="flex-1" />

        <Divider />

        <NavLink href="/account" icon={Settings} label="Settings" activeNow={active === "settings"} onNavigate={onNavigate} />
        <LogoutButton />
      </nav>
    </>
  );
}

function MobileTopBar({ onOpen }: { onOpen: () => void }) {
  return (
    <header
      className="md:hidden sticky top-0 z-30 flex items-center justify-between h-14 px-4 flex-none"
      style={{
        background: CH.sidebar,
        borderBottom: `1px solid ${CH.border}`,
      }}
    >
      <Link
        href="/cases"
        className="text-[17px] font-semibold tracking-tight"
        style={{ color: CH.text, letterSpacing: "-0.02em" }}
      >
        CodeTrawl
      </Link>
      <button
        type="button"
        onClick={onOpen}
        aria-label="Open menu"
        className={`flex h-9 w-9 items-center justify-center rounded-lg ${CH_FOCUS}`}
        style={{ color: CH.textDim, border: `1px solid ${CH.border}` }}
      >
        <Menu size={18} />
      </button>
    </header>
  );
}

function MobileDrawer({
  active,
  user,
  onClose,
}: {
  active: ChambersNav;
  user: User;
  onClose: () => void;
}) {
  // Close on Escape; lock body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div className="md:hidden fixed inset-0 z-50" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0"
        style={{ background: "rgba(0,0,0,0.55)" }}
      />
      {/* Panel */}
      <div
        className="absolute inset-y-0 left-0 flex w-[280px] max-w-[82vw] flex-col"
        style={{
          background: CH.sidebar,
          borderRight: `1px solid ${CH.border}`,
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close menu"
          className={`absolute right-3 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-lg ${CH_FOCUS}`}
          style={{ color: CH.textDim }}
        >
          <X size={18} />
        </button>
        <SidebarContent active={active} user={user} onNavigate={onClose} />
      </div>
    </div>
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
  onNavigate,
}: {
  href: string;
  icon: typeof Layers;
  label: string;
  activeNow: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] transition-colors ${CH_FOCUS}`}
      style={{
        // CodeTrawl active-state: brightness + a hairline rule, never an
        // orange wash — keeps the accent rationed and the sidebar calm.
        color: activeNow ? CH.text : CH.textDim,
        background: activeNow ? CH.panel : "transparent",
      }}
    >
      {activeNow && (
        <span
          aria-hidden
          className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r"
          style={{ background: CH.text }}
        />
      )}
      <Icon
        size={16}
        style={{ color: activeNow ? CH.text : CH.textMuted }}
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
