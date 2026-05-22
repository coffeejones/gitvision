"use client";

// Account-page chrome — hero + sidebar + content slot (v0.76 / D4).
//
// Used by every /account/* page. The shell handles:
//   - Top hero: avatar + name + email + verified badge + joined +
//     signed-in-via metadata
//   - Left sidebar: links to the four sections, active state from
//     usePathname() (real route highlighting — Linear/Stripe pattern)
//   - Right content area where the per-section panel renders via
//     the children slot
//
// Each route picks its own active section by being navigated to —
// the sidebar reads pathname directly. No prop drilling for active
// state.

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronRight,
  User as UserIcon,
  Shield,
  Link as LinkIcon,
  Trash2,
  KeyRound,
  MailCheck,
  Mail,
} from "lucide-react";
import { TOK } from "@/lib/theme";
import { MarketingNav } from "@/components/MarketingNav";
import { GithubIcon } from "@/components/GithubIcon";
import { Badge } from "@/components/account/_primitives";
import type { AccountUser } from "@/lib/userFromSession";

interface SectionLink {
  path: string;
  label: string;
  icon: React.ReactNode;
}

const SECTIONS: SectionLink[] = [
  { path: "/account/general", label: "General", icon: <UserIcon size={14} /> },
  { path: "/account/security", label: "Security", icon: <Shield size={14} /> },
  {
    path: "/account/connections",
    label: "Connections",
    icon: <LinkIcon size={14} />,
  },
  {
    path: "/account/danger",
    label: "Danger zone",
    icon: <Trash2 size={14} />,
  },
];

interface Props {
  user: AccountUser;
  /** Extra metadata for the hero "signed-in via" line. Pages that
   *  have already fetched the accounts list (Security, Connections)
   *  pass these; pages that don't (General, Danger) leave them as
   *  null and the hero just hides the icons. */
  hasPassword?: boolean;
  hasGithub?: boolean;
  children: React.ReactNode;
}

export function AccountShell({
  user,
  hasPassword,
  hasGithub,
  children,
}: Props) {
  const pathname = usePathname();

  return (
    <>
      <MarketingNav />
      <main
        className="min-h-[calc(100vh-56px)]"
        style={{ background: TOK.bg }}
      >
        <div className="max-w-5xl mx-auto px-6 py-10 sm:py-14 flex flex-col gap-10">
          <AccountHero
            user={user}
            hasPassword={hasPassword}
            hasGithub={hasGithub}
          />
          <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-10">
            <Sidebar pathname={pathname} />
            <div className="flex flex-col gap-8 min-w-0">{children}</div>
          </div>
        </div>
      </main>
    </>
  );
}

// ─── Hero ───────────────────────────────────────────────────────────

function AccountHero({
  user,
  hasPassword,
  hasGithub,
}: {
  user: AccountUser;
  hasPassword?: boolean;
  hasGithub?: boolean;
}) {
  const initials = computeInitials(user.name ?? user.email);
  const joined = formatJoined(user.createdAt);

  return (
    <header className="flex flex-col gap-1">
      <span
        className="text-xs uppercase tracking-[0.12em] font-medium"
        style={{ color: TOK.textMuted }}
      >
        Account
      </span>
      <div className="flex flex-col sm:flex-row sm:items-center gap-5 mt-3">
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.image}
            alt=""
            width={72}
            height={72}
            className="rounded-full object-cover"
            style={{ width: 72, height: 72 }}
          />
        ) : (
          <div
            className="rounded-full flex items-center justify-center text-xl font-semibold flex-shrink-0"
            style={{
              width: 72,
              height: 72,
              background: TOK.accentSoft,
              color: TOK.accent,
            }}
          >
            {initials}
          </div>
        )}
        <div className="flex flex-col gap-1 min-w-0">
          <h1
            className="text-2xl sm:text-3xl font-semibold tracking-tight"
            style={{ color: TOK.textPrimary, letterSpacing: "-0.02em" }}
          >
            {user.name || user.email.split("@")[0]}
          </h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span style={{ color: TOK.textSecondary }}>{user.email}</span>
            {user.emailVerified ? (
              <Badge
                tone="accent"
                icon={<MailCheck size={10} />}
                label="Verified"
              />
            ) : (
              <Badge
                tone="amber"
                icon={<Mail size={10} />}
                label="Not verified"
              />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs mt-1">
            <span style={{ color: TOK.textMuted }}>Joined {joined}</span>
            {hasPassword && (
              <>
                <span style={{ color: TOK.border }}>·</span>
                <span
                  className="inline-flex items-center gap-1"
                  style={{ color: TOK.textMuted }}
                >
                  <KeyRound size={11} />
                  Password
                </span>
              </>
            )}
            {hasGithub && (
              <>
                <span style={{ color: TOK.border }}>·</span>
                <span
                  className="inline-flex items-center gap-1"
                  style={{ color: TOK.textMuted }}
                >
                  <GithubIcon size={11} />
                  GitHub
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

// ─── Sidebar ────────────────────────────────────────────────────────

function Sidebar({ pathname }: { pathname: string }) {
  return (
    // Always block — earlier `hidden md:block` was hiding the sidebar
    // when viewport landed under the md breakpoint (768px). On mobile
    // the grid collapses to a single column so the sidebar stacks
    // above content as a vertical list — not ideal but at least
    // navigable. Sticky still applies on desktop where it matters.
    <nav className="block md:sticky md:top-20 self-start">
      <ul className="flex flex-col gap-0.5">
        {SECTIONS.map((s) => {
          const active = pathname === s.path;
          return (
            <li key={s.path}>
              <Link
                href={s.path}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm transition"
                style={{
                  background: active ? TOK.surface : "transparent",
                  color: active ? TOK.textPrimary : TOK.textSecondary,
                  border: `1px solid ${active ? TOK.border : "transparent"}`,
                }}
              >
                <span className="flex items-center gap-2">
                  <span
                    style={{
                      color: active ? TOK.accent : TOK.textMuted,
                    }}
                  >
                    {s.icon}
                  </span>
                  {s.label}
                </span>
                {active && (
                  <ChevronRight
                    size={12}
                    style={{ color: TOK.textMuted }}
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ─── helpers ────────────────────────────────────────────────────────

function computeInitials(source: string): string {
  const trimmed = source.trim();
  if (!trimmed) return "?";
  if (trimmed.includes("@")) return trimmed[0].toUpperCase();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatJoined(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
