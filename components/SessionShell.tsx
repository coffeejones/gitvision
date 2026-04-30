"use client";

// Workspace shell for the session page (v0.42).
//
// Replaces the v0.3-era horizontal tab strip with a persistent left
// sidebar. Each tab is now its own route under /session/[id]/<tab>;
// the sidebar is the navigation. The change is bigger than it sounds:
// it moves GitVision from "dashboard you scroll" to "workspace you
// inhabit", which is the right mental model for a tool you spend 20
// minutes inside investigating a codebase.
//
// What lives where:
//   - SessionToolbar (refresh / share / overflow) — above the shell,
//     full width. Stays as the always-visible action surface.
//   - SessionShell — the row below the toolbar. Sidebar (this file's
//     primary concern) on the left, route content (passed as
//     `children`) on the right.
//   - Each route's <main> is the screenshot target (id="screenshot-
//     target"), so screenshots capture exactly the active workspace
//     view, not the full session.

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertCircle,
  Code as CodeIcon,
  FileCode,
  GitPullRequest,
  Home,
  Network,
  Package,
} from "lucide-react";
import type { AnalysisSnapshot } from "@/lib/types";
import { STYLE, TOK } from "@/lib/theme";

interface Props {
  sessionId: string;
  snapshot: AnalysisSnapshot;
  children: React.ReactNode;
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  /** Optional small count rendered to the right (function count, file
   *  count, etc.). Hidden when undefined or zero. */
  count?: number;
  /** Red dot for "issues found" — used for the Packages tab when
   *  vulnerable / deprecated packages exist. */
  hasIssueBadge?: boolean;
  /** Subtle "refresh me" hint for tabs whose data isn't on the
   *  snapshot yet (legacy snapshots without codeGraph etc.). */
  hint?: string;
}

export function SessionShell({ sessionId, snapshot, children }: Props) {
  const pathname = usePathname();
  const base = `/session/${sessionId}`;

  // Counts that drive the sidebar badges. Same logic as the v0.3 tab
  // bar — preserved here so users still see "Code · 22,041" at a
  // glance without having to click in.
  const hasGraph = !!snapshot.fileGraph;
  const hasCodeGraph = !!snapshot.codeGraph;
  const depCount = snapshot.fileGraph?.nodes.length ?? 0;
  const codeFunctionCount = snapshot.codeGraph?.functions.length ?? 0;
  const prCount = snapshot.pullRequests?.length ?? 0;
  const healths =
    snapshot.dependencyHealths ??
    (snapshot.dependencyHealth ? [snapshot.dependencyHealth] : []);
  const packageCount = healths.reduce(
    (s, h) => s + (h.uniquePackages ?? h.total),
    0
  );
  const packageIssues = healths.reduce(
    (s, h) => s + h.vulnerable.length + h.deprecated.length,
    0
  );

  const items: NavItem[] = [
    {
      label: "Overview",
      href: base,
      icon: <Home size={14} />,
    },
    {
      label: "Canvas",
      href: `${base}/canvas`,
      icon: <Network size={14} />,
    },
    {
      label: "Imports",
      href: `${base}/imports`,
      icon: <FileCode size={14} />,
      count: hasGraph ? depCount : undefined,
      hint: hasGraph ? undefined : "refresh",
    },
    {
      label: "Code",
      href: `${base}/code`,
      icon: <CodeIcon size={14} />,
      count: hasCodeGraph ? codeFunctionCount : undefined,
      hint: hasCodeGraph ? undefined : "refresh",
    },
    {
      label: "Packages",
      href: `${base}/packages`,
      icon: <Package size={14} />,
      count: packageCount > 0 ? packageCount : undefined,
      hasIssueBadge: packageIssues > 0,
    },
    {
      label: "PRs",
      href: `${base}/prs`,
      icon: <GitPullRequest size={14} />,
      count: prCount > 0 ? prCount : undefined,
    },
  ];

  return (
    <div className="flex w-full">
      <aside
        className="shrink-0 sticky self-start flex flex-col gap-1 px-3 py-5 z-20"
        style={{
          // Sit immediately below the 48px sticky topbar.
          top: 48,
          width: 224,
          // Fill the rest of the viewport so the bottom of the sidebar
          // never floats. Use 100dvh on browsers that support it for
          // mobile address-bar correctness.
          height: "calc(100dvh - 48px)",
          borderRight: `1px solid ${TOK.border}`,
          background: TOK.bg,
          overflowY: "auto",
        }}
      >
        <div
          className="px-2 pb-3 mb-1"
          style={{ borderBottom: `1px solid ${TOK.border}` }}
        >
          <Link
            href="/"
            className="text-xs inline-flex items-center gap-1.5 transition hover:underline"
            style={{ color: TOK.textMuted }}
          >
            ← All sessions
          </Link>
        </div>

        <span
          className={`px-2 ${STYLE.eyebrow}`}
          style={{ color: TOK.textMuted }}
        >
          Workspace
        </span>

        <nav className="flex flex-col gap-0.5 mt-1">
          {items.map((item) => {
            // Active = exact path match. Sub-routes (e.g. /code with
            // future ?file=... params) all share the /code segment so
            // exact-match keeps the Code item highlighted regardless
            // of query state.
            const active =
              item.href === base
                ? pathname === base
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <SidebarLink
                key={item.href}
                item={item}
                active={active}
              />
            );
          })}
        </nav>
      </aside>

      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}

function SidebarLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md transition text-sm"
      style={{
        background: active ? TOK.accentSoft : "transparent",
        color: active ? TOK.textPrimary : TOK.textSecondary,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = TOK.surface;
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      <span style={{ color: active ? TOK.accent : TOK.textMuted }}>
        {item.icon}
      </span>
      <span className="flex-1">{item.label}</span>
      {item.hasIssueBadge && (
        <span
          className="h-1.5 w-1.5 rounded-full shrink-0"
          style={{ background: TOK.rose }}
          title="Issues detected"
        />
      )}
      {item.count !== undefined && (
        <span
          className="text-[10px] font-mono px-1 rounded tabular-nums shrink-0"
          style={{
            background: active ? TOK.surface : TOK.surfaceElevated,
            color: TOK.textMuted,
          }}
        >
          {formatCount(item.count)}
        </span>
      )}
      {item.hint && (
        <span
          className="text-[10px] inline-flex items-center gap-1 shrink-0"
          style={{ color: TOK.textMuted }}
          title="Snapshot is missing this data — click Refresh in the topbar to populate"
        >
          <AlertCircle size={10} />
          {item.hint}
        </span>
      )}
    </Link>
  );
}

/** Format counts so 22,041 doesn't blow up the sidebar. K-suffix
 *  above 1000, no decimal — accuracy is less important than fitting
 *  in the chip. */
function formatCount(n: number): string {
  if (n < 1_000) return n.toString();
  if (n < 1_000_000) return `${Math.round(n / 1_000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
