"use client";

// SettingsShell — the account-settings chrome INSIDE the Chambers workspace
// shell (CH theme). Replaces the old marketing-themed AccountShell: the
// persistent sidebar now comes from app/(workspace)/layout.tsx, so this is
// content-only — a "Settings" header + identity hero + a horizontal
// sub-section tab bar (General / Billing / Security / Connections / Danger),
// with the active panel rendered via children. Active tab from usePathname.

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CreditCard,
  User as UserIcon,
  Shield,
  Link as LinkIcon,
  Trash2,
  MailCheck,
  Mail,
} from "lucide-react";
import { CH, CH_FOCUS } from "@/components/chambers/theme";
import type { AccountUser } from "@/lib/userFromSession";

interface SectionLink {
  path: string;
  label: string;
  icon: typeof UserIcon;
}

const SECTIONS: SectionLink[] = [
  { path: "/account/general", label: "General", icon: UserIcon },
  { path: "/account/billing", label: "Billing", icon: CreditCard },
  { path: "/account/security", label: "Security", icon: Shield },
  { path: "/account/connections", label: "Connections", icon: LinkIcon },
  { path: "/account/danger", label: "Danger zone", icon: Trash2 },
];

export function SettingsShell({
  user,
  children,
}: {
  user: AccountUser;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const initial = computeInitial(user.name ?? user.email);
  const joined = formatJoined(user.createdAt);

  return (
    <div>
      {/* Header + identity */}
      <header className="mb-6">
        <h1
          className="flex items-center gap-2.5 text-[28px] font-semibold tracking-tight"
          style={{ color: CH.text, letterSpacing: "-0.02em" }}
        >
          <span aria-hidden style={{ fontSize: 22, lineHeight: 1 }}>
            ⚙️
          </span>
          Settings
        </h1>
        <div className="mt-3 flex items-center gap-3.5">
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.image}
              alt=""
              width={44}
              height={44}
              className="rounded-full object-cover"
              style={{ width: 44, height: 44 }}
            />
          ) : (
            <span
              className="flex flex-none items-center justify-center rounded-full text-base font-semibold"
              style={{
                width: 44,
                height: 44,
                background: CH.elevated,
                border: `1px solid ${CH.borderStrong}`,
                color: CH.textDim,
              }}
            >
              {initial}
            </span>
          )}
          <div className="flex min-w-0 flex-col">
            <span className="text-[15px] font-medium" style={{ color: CH.text }}>
              {user.name || user.email.split("@")[0]}
            </span>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12.5px]">
              <span style={{ color: CH.textDim }}>{user.email}</span>
              {user.emailVerified ? (
                <Pill tone={CH.ok} icon={<MailCheck size={10} />} label="Verified" />
              ) : (
                <Pill tone={CH.warning} icon={<Mail size={10} />} label="Not verified" />
              )}
              <span style={{ color: CH.textMuted }}>· Joined {joined}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Sub-section tabs */}
      <div
        className="mb-6 flex flex-wrap items-center gap-1"
        style={{ borderBottom: `1px solid ${CH.border}` }}
        role="tablist"
      >
        {SECTIONS.map((s) => {
          const active = pathname === s.path;
          const Icon = s.icon;
          const danger = s.path === "/account/danger";
          return (
            <Link
              key={s.path}
              href={s.path}
              role="tab"
              aria-selected={active}
              className={`relative inline-flex items-center gap-1.5 rounded-md px-3 py-2.5 text-[13.5px] font-medium transition-colors ${CH_FOCUS}`}
              style={{
                color: active
                  ? danger
                    ? CH.critical
                    : CH.text
                  : CH.textMuted,
              }}
            >
              <Icon size={13} />
              {s.label}
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-x-2 -bottom-px h-[2px] rounded-full"
                  style={{ background: danger ? CH.critical : CH.accent }}
                />
              )}
            </Link>
          );
        })}
      </div>

      <div className="flex flex-col gap-6">{children}</div>
    </div>
  );
}

function Pill({
  tone,
  icon,
  label,
}: {
  tone: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]"
      style={{ color: tone, background: `${tone}1f` }}
    >
      {icon}
      {label}
    </span>
  );
}

function computeInitial(source: string): string {
  const t = source.trim();
  if (!t) return "?";
  if (t.includes("@")) return t[0].toUpperCase();
  const parts = t.split(/\s+/).filter(Boolean);
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
