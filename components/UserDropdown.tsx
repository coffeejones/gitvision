"use client";

// Logged-in user menu (v0.75).
//
// Sits in MarketingNav (and later WorkspaceHome's nav) when the caller
// is authenticated. Shows an avatar with the user's initials (or image
// if GitHub OAuth provided one), and a dropdown with quick links and
// logout.
//
// Why a custom dropdown instead of a library: we already render every
// other dropdown (settings menu, share, etc.) with our own pattern.
// Pulling in radix/headlessui for one menu is overkill and bloats the
// bundle. Click-outside + Esc handles the keyboard story sufficiently
// for now.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LogOut, ChevronDown, Settings } from "lucide-react";
import { TOK } from "@/lib/theme";
import { authClient } from "@/lib/authClient";

interface User {
  id: string;
  name?: string | null;
  email: string;
  image?: string | null;
  githubLogin?: string | null;
}

export function UserDropdown({ user }: { user: User }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on click outside + Esc. Same affordance pattern as our
  // other dropdowns so muscle memory transfers.
  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await authClient.signOut();
      router.push("/");
      router.refresh();
    } catch {
      // If signOut fails (network), the cookie may or may not be
      // cleared. Reload the page — the home route's session check
      // will land them in the right spot either way.
      window.location.href = "/";
    }
  }

  // Initials fallback when no avatar image. "Jonas Hansen" → "JH",
  // "jonas@example.com" → "J".
  const initials = computeInitials(user.name ?? user.email);
  const displayName = user.name ?? user.email.split("@")[0];

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 h-8 pl-1 pr-2 rounded-md transition hover:bg-white/5 cursor-pointer"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar
          image={user.image ?? null}
          initials={initials}
          size={24}
        />
        <ChevronDown
          size={12}
          style={{
            color: TOK.textMuted,
            transform: open ? "rotate(180deg)" : "rotate(0)",
            transition: "transform 150ms",
          }}
        />
      </button>

      {open && (
        <div
          // Anchor right so the menu doesn't slip off-screen on narrow
          // viewports. min-width keeps the menu wide enough that the
          // email line doesn't wrap.
          className="absolute right-0 top-full mt-2 rounded-lg shadow-2xl overflow-hidden z-50"
          style={{
            background: TOK.surfaceElevated,
            border: `1px solid ${TOK.borderStrong}`,
            minWidth: 220,
          }}
          role="menu"
        >
          {/* Identity row — name + email */}
          <div
            className="flex flex-col gap-0.5 px-3 py-3"
            style={{ borderBottom: `1px solid ${TOK.border}` }}
          >
            <span
              className="text-sm font-medium truncate"
              style={{ color: TOK.textPrimary }}
            >
              {displayName}
            </span>
            <span
              className="text-xs truncate"
              style={{ color: TOK.textMuted }}
            >
              {user.email}
            </span>
            {user.githubLogin && (
              <span
                className="text-[11px] truncate"
                style={{ color: TOK.textMuted }}
              >
                @{user.githubLogin}
              </span>
            )}
          </div>

          {/* Quick links. */}
          <div className="flex flex-col py-1">
            <MenuLink href="/" onClick={() => setOpen(false)}>
              Your sessions
            </MenuLink>
            <MenuLink href="/account" onClick={() => setOpen(false)}>
              <Settings size={13} />
              Account settings
            </MenuLink>
          </div>

          {/* Logout — separated visually with a top border. */}
          <div
            className="flex flex-col py-1"
            style={{ borderTop: `1px solid ${TOK.border}` }}
          >
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="flex items-center gap-2 px-3 py-2 text-sm transition hover:bg-white/5 disabled:opacity-50 cursor-pointer text-left"
              style={{ color: TOK.textSecondary }}
              role="menuitem"
            >
              <LogOut size={13} />
              {loggingOut ? "Logging out…" : "Log out"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Avatar({
  image,
  initials,
  size,
}: {
  image: string | null;
  initials: string;
  size: number;
}) {
  if (image) {
    return (
      // Plain <img> rather than next/image — avatars from GitHub are
      // small (140×140 max), already optimized at the CDN, and we'd
      // pay for next/image's loader pipeline without benefit.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image}
        alt=""
        width={size}
        height={size}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="rounded-full flex items-center justify-center text-[11px] font-semibold"
      style={{
        width: size,
        height: size,
        background: TOK.accentSoft,
        color: TOK.accent,
      }}
    >
      {initials}
    </div>
  );
}

function MenuLink({
  href,
  onClick,
  children,
}: {
  href: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 text-sm transition hover:bg-white/5"
      style={{ color: TOK.textSecondary }}
      role="menuitem"
    >
      {children}
    </Link>
  );
}

/** "Jonas Hansen" → "JH"; "jonas@example.com" → "J"; "j" → "J". */
function computeInitials(source: string): string {
  const trimmed = source.trim();
  if (!trimmed) return "?";
  // Email — take first letter only
  if (trimmed.includes("@")) {
    return trimmed[0].toUpperCase();
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
