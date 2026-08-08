"use client";

// Workspace shell for the session page (v0.42).
//
// Replaces the v0.3-era horizontal tab strip with a persistent left
// sidebar. Each tab is now its own route under /session/[id]/<tab>;
// the sidebar is the navigation. The change is bigger than it sounds:
// it moves CodeTrawl from "dashboard you scroll" to "workspace you
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

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  AlertCircle,
  Boxes,
  ChevronDown,
  Compass,
  Code as CodeIcon,
  FileCode,
  FileText,
  Fingerprint,
  Gauge,
  GitPullRequest,
  Home,
  ListChecks,
  Menu,
  Microscope,
  Network,
  Package,
  FlaskConical,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Shield,
  ShieldAlert,
  Route,
  X,
  Sparkles,
  Stethoscope,
  Truck,
  Zap,
} from "lucide-react";
import type {
  ClientSnapshot,
  PaletteIndex,
  ShellGraphCounts,
} from "@/lib/clientSnapshot";
import { STYLE, TOK } from "@/lib/sessionTheme";
import { CH_FOCUS } from "@/components/chambers/theme";
import { CommandPalette } from "./CommandPalette";
import { WorkspaceMotion } from "./views/WorkspaceMotion";
import { GuidedProgress } from "./views/GuidedProgress";
import { isSubjectId, SUBJECTS } from "@/lib/brief/types";

interface Props {
  sessionId: string;
  snapshot: ClientSnapshot;
  /** Derived server-side — see lib/clientSnapshot.ts. The sidebar needs five
   *  scalars off the two graphs, not the graphs. */
  graphCounts: ShellGraphCounts;
  /** The palette's searchable index, capped and flattened on the server.
   *  Null when the snapshot has no code graph. */
  paletteIndex: PaletteIndex | null;
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
  /** Accent dot for "new feature lives here" — used for the PRs
   *  tab to surface the CodeTrawl PR-bot callout that sits below
   *  the historical PR-flow analysis. Discrete; not an alert. */
  hasNewFeatureBadge?: boolean;
  /** Subtle "refresh me" hint for tabs whose data isn't on the
   *  snapshot yet (legacy snapshots without codeGraph etc.). */
  hint?: string;
}

/** The sidebar is grouped into the four lenses that combine into the
 *  Final grade. Each lens owns a focused mandate, named for the work it
 *  does (Health, Security, Forensics, Supply) so the label reads as its
 *  domain. Adding a new lens later is just a new entry here — no other
 *  UI touches needed. (The `Department` type name is kept internally to
 *  avoid churn; it carries no courtroom meaning anymore.) */
interface Department {
  /** Title shown as a small uppercase header above the items. */
  title: string;
  /** Lucide icon paired with the title — chosen to evoke the
   *  department's role distinctly from its child tab icons. */
  icon: React.ReactNode;
  /** Tabs that belong to this department. */
  items: NavItem[];
}

export function SessionShell({
  sessionId,
  snapshot,
  graphCounts,
  paletteIndex,
  children,
}: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const base = `/session/${sessionId}`;

  // A brief's evidence links carry their origin in the URL, so the owning
  // workspace page can offer a real return path without storing hidden client
  // state. The change goal uses Faultline directly because it needs a target;
  // it carries `goal=change` through the same context strip.
  const briefSubjectParam = searchParams.get("subject");
  const briefSubject =
    searchParams.get("from") === "brief" &&
    briefSubjectParam !== null &&
    isSubjectId(briefSubjectParam)
      ? briefSubjectParam
      : null;
  const changeGoal = searchParams.get("goal") === "change";
  const guidedTitle = briefSubject
    ? SUBJECTS[briefSubject].title
    : changeGoal
      ? "Plan a change safely"
      : null;
  const continueParams = new URLSearchParams(searchParams.toString());
  continueParams.delete("from");
  continueParams.delete("subject");
  continueParams.delete("goal");
  const continueQuery = continueParams.toString();
  const continueHref = `${pathname}${continueQuery ? `?${continueQuery}` : ""}`;

  // v0.47 Cmd+K palette state lives here so the sidebar's "Search…"
  // trigger can open it without poking at internal CommandPalette
  // state. The keyboard handler also lives here so Cmd+K works even
  // when CommandPalette isn't currently rendering anything (it
  // returns null when closed).
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Mobile nav drawer. The 224px sidebar is hidden below md (it would crush
  // the content area on a phone); a top-bar hamburger opens the same nav as
  // a slide-in drawer instead. Close it on route change + Escape.
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  // Per-department collapse state. The active department always renders
  // expanded (so you never lose the tab you're on); this only governs the
  // user's manual collapse choice for the others. Persisted in localStorage
  // so a hard reload remembers it — SessionShell lives in the [id] layout,
  // so collapse already survives tab navigation without this. Init empty
  // (server renders everything expanded) and hydrate after mount to avoid an
  // SSR mismatch.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem("rj.sessionNav.collapsed");
      if (raw) setCollapsed(JSON.parse(raw) as Record<string, boolean>);
    } catch {
      // Corrupt/unavailable storage — fall back to all-expanded.
    }
  }, []);
  function toggleDept(title: string) {
    setCollapsed((prev) => {
      const next = { ...prev, [title]: !prev[title] };
      try {
        localStorage.setItem("rj.sessionNav.collapsed", JSON.stringify(next));
      } catch {
        // Ignore storage failures — the toggle still works in-session.
      }
      return next;
    });
  }

  // Focus mode: hide the whole sidebar so the content (canvas, imports
  // split-pane, etc.) gets the full width. Persisted like the dept collapse;
  // server renders it visible and we hydrate after mount to avoid an SSR
  // mismatch. A floating button in the content gutter brings it back.
  const [sidebarHidden, setSidebarHidden] = useState(false);
  useEffect(() => {
    try {
      setSidebarHidden(localStorage.getItem("rj.sessionNav.hidden") === "1");
    } catch {
      // Storage unavailable — stay visible.
    }
  }, []);
  function setHidden(hidden: boolean) {
    setSidebarHidden(hidden);
    try {
      localStorage.setItem("rj.sessionNav.hidden", hidden ? "1" : "0");
    } catch {
      // Ignore — the toggle still works in-session.
    }
  }

  // Counts that drive the sidebar badges. Same logic as the v0.3 tab
  // bar — preserved here so users still see "Code · 22,041" at a
  // glance without having to click in.
  const { hasGraph, hasCodeGraph, depCount, codeFunctionCount, classCount } =
    graphCounts;
  const prCount = snapshot.pullRequests?.length ?? 0;
  const healths =
    snapshot.dependencyHealths ??
    (snapshot.dependencyHealth ? [snapshot.dependencyHealth] : []);
  const packageCount = healths.reduce(
    (s, h) => s + (h.uniquePackages ?? h.total),
    0,
  );
  const packageIssues = healths.reduce(
    (s, h) => s + h.vulnerable.length + h.deprecated.length,
    0,
  );

  // v0.81+: red-dot indicator on the Security tab when any scanner
  // has findings. risky-eval-patterns is informational so it doesn't
  // count — only "real" issues (secrets + incidents) trigger the
  // badge. The session-level matches array is queried via the same
  // findIncidentMatches helper the page uses; doing it here keeps
  // the sidebar honest about whether there's something to see.
  const secretCount = snapshot.secretFindings?.findings.length ?? 0;
  // Cheap proxy: any dependency in the snapshot AND we have any
  // detector run, since findIncidentMatches() is server-only and
  // we'd need an async path. For the sidebar dot we just light up
  // on any secret findings — incidents will surface visibly inside
  // the tab regardless. Avoiding a per-render incident-DB walk
  // keeps the navigation render cheap.
  const hasSecurityIssue = secretCount > 0;

  const departments: Department[] = [
    {
      // The clinical read on the codebase — summary, AI commentary,
      // and the raw signal evidence. Named "Department" because it's
      // the holistic patient-chart view (vitals, physician's notes,
      // lab results) rather than a specialized investigation.
      title: "Health",
      icon: <Stethoscope size={12} />,
      items: [
        {
          label: "Overview",
          href: base,
          icon: <Home size={14} />,
        },
        {
          label: "Insights",
          href: `${base}/insights`,
          icon: <Sparkles size={14} />,
        },
        {
          // The data behind Health at a Glance — all HEALTH_SIGNAL_COUNT deterministic
          // signals (working / needsWork / questions) so devs can drill
          // into specific evidence beyond the 6 aggregated tiles.
          label: "Signals",
          href: `${base}/signals`,
          icon: <ListChecks size={14} />,
        },
      ],
    },
    {
      // The investigative arm — supply-chain incidents, secret
      // leakage, risky dynamic-execution patterns. "Bureau" because
      // it's the FBI/CIA-style focused unit (one mandate, depth over
      // breadth) rather than a hospital wing or a forensics bench.
      title: "Security",
      icon: <Fingerprint size={12} />,
      items: [
        {
          label: "Security",
          href: `${base}/security`,
          icon: <Shield size={14} />,
          hasIssueBadge: hasSecurityIssue,
        },
      ],
    },
    {
      // Deep structural inspection of the codebase — the part of the
      // jury that takes the case apart under the microscope. "Lab"
      // because Architecture / Canvas / Code / Imports are all
      // examination instruments rather than administrative offices.
      title: "Forensics",
      icon: <Microscope size={12} />,
      items: [
        {
          // "How does this work?" — pick an entry point (route, handler, main)
          // and see what it reaches. Leads Forensics because it's the gentlest
          // instrument: you read the flow before you take anything apart, and
          // it's the one surface that assumes no prior knowledge of the repo.
          label: "Flows",
          href: `${base}/flows`,
          icon: <Route size={14} />,
          hasNewFeatureBadge: true,
          hint: hasCodeGraph ? undefined : "refresh",
        },
        {
          // Arc 1 "Can I touch this?" — the action surface: files ranked by how
          // safely you can change them. Leads Forensics because it's the
          // "so what do I do?" answer to the structural views below it.
          label: "Refactor",
          href: `${base}/refactor`,
          icon: <ShieldAlert size={14} />,
          hint: hasCodeGraph ? undefined : "refresh",
        },
        {
          // The Faultline Simulator — the live "what if I change this?" surface.
          // Pick a file → simulate deleting it → deterministic blast + the
          // required-actions conscience (Shadow-Graph patcher). Sits right below
          // Refactor as its interactive sibling.
          label: "Faultline",
          href: `${base}/faultline`,
          icon: <Zap size={14} />,
          hasNewFeatureBadge: true,
          hint: hasCodeGraph ? undefined : "refresh",
        },
        {
          // Arc 1 Weak-Suite — "coverage that means nothing": test files ranked
          // by how hollow their assertions are. Sits by Refactor as the other
          // "can I trust this?" surface.
          label: "Test quality",
          href: `${base}/testquality`,
          icon: <FlaskConical size={14} />,
          hint: hasCodeGraph ? undefined : "refresh",
        },
        {
          // v0.70: Architecture tab — first beboer is class diagrams.
          // Future deeper-intelligence themes (hidden coupling,
          // knowledge ranking, pattern detection) land here too.
          label: "Architecture",
          href: `${base}/architecture`,
          icon: <Boxes size={14} />,
          count: hasCodeGraph && classCount > 0 ? classCount : undefined,
          hint: hasCodeGraph ? undefined : "refresh",
        },
        {
          label: "Canvas",
          href: `${base}/canvas`,
          icon: <Network size={14} />,
        },
        {
          label: "Code",
          href: `${base}/code`,
          icon: <CodeIcon size={14} />,
          count: hasCodeGraph ? codeFunctionCount : undefined,
          hint: hasCodeGraph ? undefined : "refresh",
        },
        {
          // The read-only Source view — GitHub's blob view with CodeTrawl's
          // deterministic findings on every line. The drill-down destination
          // the other Forensics surfaces deep-link into. Source is fetched live
          // per file and never stored.
          label: "Source",
          href: `${base}/source`,
          icon: <FileText size={14} />,
          hasNewFeatureBadge: true,
          hint: hasCodeGraph ? undefined : "refresh",
        },
        {
          label: "Imports",
          href: `${base}/imports`,
          icon: <FileCode size={14} />,
          count: hasGraph ? depCount : undefined,
          hint: hasGraph ? undefined : "refresh",
        },
      ],
    },
    {
      // Supply chain and delivery flow — dependencies coming in,
      // pull requests going out. "Office" because it's the
      // logistics desk (orders, shipments, paperwork) more than a
      // bureau or a lab.
      title: "Supply",
      icon: <Truck size={12} />,
      items: [
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
          hasNewFeatureBadge: true,
        },
      ],
    },
  ];

  // The sidebar's inner content, shared by the desktop aside and the mobile
  // drawer. `onNavigate` (drawer only) closes the drawer on a tap.
  const sidebarBody = (onNavigate?: () => void, onHide?: () => void) => (
    <>
      <div
        className="px-2 pb-3 mb-1 flex flex-col gap-2"
        style={{ borderBottom: `1px solid ${TOK.border}` }}
      >
        <div className="flex items-center justify-between gap-2">
          <Link
            href="/"
            onClick={onNavigate}
            className="text-xs inline-flex items-center gap-1.5 transition hover:underline"
            style={{ color: TOK.textMuted }}
          >
            ← All sessions
          </Link>
          {onHide && (
            <button
              type="button"
              onClick={onHide}
              aria-label="Hide sidebar"
              title="Hide sidebar for focus"
              className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition ${CH_FOCUS}`}
              style={{ color: TOK.textMuted }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = TOK.textSecondary;
                e.currentTarget.style.background = TOK.surface;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = TOK.textMuted;
                e.currentTarget.style.background = "transparent";
              }}
            >
              <PanelLeftClose size={14} />
            </button>
          )}
        </div>
        <button
          onClick={() => {
            setPaletteOpen(true);
            onNavigate?.();
          }}
          className={`flex items-center gap-2 px-2 h-8 rounded-md text-xs transition cursor-text text-left ${CH_FOCUS}`}
          style={{
            background: TOK.surface,
            border: `1px solid ${TOK.border}`,
            color: TOK.textMuted,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = TOK.borderStrong;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = TOK.border;
          }}
          title="Cmd+K — jump to a page, file, or function"
        >
          <Search size={11} />
          <span className="flex-1">Search…</span>
          <span
            className="text-[9px] font-mono px-1 rounded shrink-0"
            style={{
              background: TOK.surfaceElevated,
              border: `1px solid ${TOK.border}`,
            }}
          >
            ⌘K
          </span>
        </button>
      </div>

      {/* Pick a question, above the instruments.
          The workspace has sixteen destinations and the visitor has to know
          which one answers their question. This inverts it: choose the subject,
          get the answer composed across tabs. It sits ABOVE the departments
          rather than inside one, because a question is not a department — and
          it is a plain link, so the back button removes it and nothing is
          stored per user or has to be cleaned up when a session is deleted.
          The three subjects live on the brief itself, so this entry does not
          have to know them. */}
      <Link
        href={`${base}/brief`}
        className="flex items-center gap-2 rounded-lg px-2.5 py-2 mb-2 text-[13px] transition"
        style={{
          border: `1px solid ${pathname.startsWith(`${base}/brief`) ? TOK.accent : TOK.border}`,
          background: pathname.startsWith(`${base}/brief`)
            ? TOK.surfaceElevated
            : "transparent",
          color: pathname.startsWith(`${base}/brief`)
            ? TOK.textPrimary
            : TOK.textSecondary,
        }}
      >
        <Compass size={14} />
        <span>Choose a goal</span>
      </Link>

      <nav className="flex flex-col gap-1">
        {departments.map((dept, di) => {
          // Active = exact path match. Sub-routes (e.g. /code with future
          // ?file=... params) share the segment, so exact-match keeps the
          // item highlighted regardless of query state.
          const isActive = (item: NavItem) =>
            item.href === base
              ? pathname === base
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const deptActive = dept.items.some(isActive);
          // The active department is always open so the current tab can't
          // hide; otherwise honour the user's manual collapse.
          const open = deptActive || !collapsed[dept.title];
          const panelId = `dept-${dept.title.toLowerCase().replace(/\s+/g, "-")}`;
          return (
            <div
              key={dept.title}
              className="flex flex-col gap-0.5"
              style={di > 0 ? { marginTop: 10 } : undefined}
            >
              <button
                type="button"
                onClick={() => toggleDept(dept.title)}
                aria-expanded={open}
                aria-controls={panelId}
                className={`group flex w-full items-center gap-1.5 px-2 py-1 rounded-md transition-colors ${STYLE.eyebrow} ${CH_FOCUS}`}
                style={{ color: TOK.textMuted }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = TOK.textSecondary;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = TOK.textMuted;
                }}
                title={open ? "Collapse" : "Expand"}
              >
                <span>{dept.icon}</span>
                <span className="flex-1 text-left">{dept.title}</span>
                <ChevronDown
                  size={12}
                  style={{
                    opacity: 0.55,
                    transform: open ? "rotate(0deg)" : "rotate(-90deg)",
                    transition: "transform 160ms ease",
                  }}
                />
              </button>
              {/* Collapse via grid-rows 1fr→0fr (smooth height anim); the
                  inner wrapper clips. `inert` when closed keeps the hidden
                  links out of tab order + the a11y tree. */}
              <div
                id={panelId}
                inert={!open}
                style={{
                  display: "grid",
                  gridTemplateRows: open ? "1fr" : "0fr",
                  transition:
                    "grid-template-rows 220ms cubic-bezier(0.4, 0, 0.2, 1)",
                }}
              >
                {/* Clip wrapper has no padding/border of its own, so it
                    collapses cleanly to 0 (no leftover stub). The guide line
                    + indent live on the inner element and stay constant —
                    toggling animates only height, never a horizontal jump.
                    A short opacity fade softens the in/out. */}
                <div
                  style={{
                    overflow: "hidden",
                    minHeight: 0,
                    opacity: open ? 1 : 0,
                    transition: "opacity 150ms ease",
                  }}
                >
                  <div
                    className="flex flex-col gap-0.5 pt-1"
                    style={{
                      marginLeft: 13,
                      paddingLeft: 8,
                      borderLeft: `1px solid ${TOK.border}`,
                    }}
                  >
                    {dept.items.map((item) => (
                      <SidebarLink
                        key={item.href}
                        item={item}
                        active={isActive(item)}
                        onNavigate={onNavigate}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </nav>

      {/* Final grade — the climax button. Pinned to the bottom of
          the sidebar (mt-auto) so it reads as the "submit your
          findings" action after the user has visited the
          departments. Styled as a primary action rather than a
          sidebar link to differentiate it from the per-tab nav. */}
      <VerdictPin base={base} pathname={pathname} onNavigate={onNavigate} />
    </>
  );

  return (
    <div className="ct-ws flex w-full">
      {/* Reveal engine (Phase 2 / Move D). Scoped to this .ct-ws subtree; tags
          only take effect where a page opts in with data-rv. Uses presentation-
          only Web Animations, so React remains the sole owner of DOM attributes. */}
      <WorkspaceMotion />
      {/* Desktop sidebar — hidden below md (would crush the content) and
          hidden entirely in focus mode (user toggled it away). */}
      <aside
        className={`shrink-0 sticky self-start flex-col gap-1 px-3 py-5 z-20 ${
          sidebarHidden ? "hidden" : "hidden md:flex"
        }`}
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
        {sidebarBody(undefined, () => setHidden(true))}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Focus mode: a floating button to bring the sidebar back (desktop
            only — mobile uses the hamburger drawer, which is always available). */}
        {sidebarHidden && (
          <button
            type="button"
            onClick={() => setHidden(false)}
            aria-label="Show sidebar"
            title="Show sidebar"
            className={`hidden md:flex fixed z-20 h-8 w-8 items-center justify-center rounded-md ${CH_FOCUS}`}
            style={{
              top: 56,
              left: 12,
              background: TOK.surface,
              border: `1px solid ${TOK.border}`,
              color: TOK.textSecondary,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = TOK.borderStrong;
              e.currentTarget.style.color = TOK.textPrimary;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = TOK.border;
              e.currentTarget.style.color = TOK.textSecondary;
            }}
          >
            <PanelLeftOpen size={16} />
          </button>
        )}
        {/* Mobile nav trigger — below md, where the sidebar is hidden. */}
        <div
          className="md:hidden sticky z-20 flex items-center gap-2 px-4 py-2"
          style={{
            top: 48,
            background: TOK.bg,
            borderBottom: `1px solid ${TOK.border}`,
          }}
        >
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            className="inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs"
            style={{
              background: TOK.surface,
              border: `1px solid ${TOK.border}`,
              color: TOK.textSecondary,
            }}
          >
            <Menu size={14} />
            Pages
          </button>
        </div>

        {/* A focused goal never replaces the workspace. Evidence links from a
            brief and the change-planning entry both carry URL context, so the
            reader can return to the answer or drop back into free exploration
            from any owning surface. */}
        {guidedTitle && (
          <div
            className="px-4 md:px-8 pt-4 md:sticky md:z-10"
            style={{ top: 48, background: TOK.bg }}
          >
            <div
              className="max-w-7xl mx-auto flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3 rounded-lg px-4 py-3"
              style={{
                border: `1px solid ${TOK.border}`,
                background: TOK.surface,
              }}
            >
              <span className="flex items-center gap-3 min-w-0">
                <Compass
                  size={14}
                  style={{ color: TOK.accent, flexShrink: 0 }}
                />
                <span className="flex flex-col gap-0.5 min-w-0">
                  <span
                    className="text-[10px] uppercase tracking-[0.13em]"
                    style={{ color: TOK.textMuted }}
                  >
                    Guided analysis
                  </span>
                  <span
                    className="text-xs truncate"
                    style={{ color: TOK.textSecondary }}
                  >
                    {guidedTitle}
                  </span>
                </span>
              </span>
              {briefSubject && (
                <GuidedProgress
                  current={2}
                  answerHref={`${base}/brief/${briefSubject}`}
                />
              )}
              <span className="flex items-center gap-2 flex-wrap shrink-0">
                <Link
                  href={
                    briefSubject
                      ? `${base}/brief/${briefSubject}`
                      : `${base}/brief`
                  }
                  className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] transition"
                  style={{
                    border: `1px solid ${TOK.border}`,
                    color: TOK.textSecondary,
                  }}
                >
                  <ArrowLeft size={12} />
                  {briefSubject ? "Back to answer" : "Change goal"}
                </Link>
                <Link
                  href={continueHref}
                  className="rounded-md px-2.5 py-1.5 text-[11px] transition"
                  style={{ color: TOK.textMuted }}
                >
                  {briefSubject
                    ? "Continue in workspace"
                    : "Continue in Faultline"}
                </Link>
              </span>
            </div>
          </div>
        )}

        <main className="flex-1 min-w-0">{children}</main>
      </div>

      {/* Mobile drawer — the full session nav, slid in over the content. */}
      {drawerOpen && (
        <div
          className="md:hidden fixed inset-0 z-50"
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0"
            style={{ background: "rgba(0,0,0,0.55)" }}
          />
          <div
            className="absolute inset-y-0 left-0 flex w-[260px] max-w-[82vw] flex-col gap-1 overflow-y-auto px-3 py-5"
            style={{
              background: TOK.bg,
              borderRight: `1px solid ${TOK.border}`,
            }}
          >
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close navigation"
              className="absolute right-2 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-md"
              style={{ color: TOK.textMuted }}
            >
              <X size={16} />
            </button>
            {sidebarBody(() => setDrawerOpen(false))}
          </div>
        </div>
      )}

      <CommandPalette
        sessionId={sessionId}
        index={paletteIndex}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
      />
    </div>
  );
}

function SidebarLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
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
      {item.hasNewFeatureBadge && (
        <span
          className="h-1.5 w-1.5 rounded-full shrink-0"
          style={{ background: TOK.accent }}
          title="New: CodeTrawl PR-bot available"
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

/** Final grade pin — the climax button at the bottom of the
 *  sidebar (v0.82+, Phase C). Visually distinct from the per-tab
 *  sidebar links: outlined card with grade icon + bold label rather
 *  than a thin nav row. Pinned to the bottom via `mt-auto` so it
 *  reads as "submit your findings" after the user has walked through
 *  the four departments. */
function VerdictPin({
  base,
  pathname,
  onNavigate,
}: {
  base: string;
  pathname: string;
  onNavigate?: () => void;
}) {
  const href = `${base}/verdict`;
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="mt-auto pt-4">
      <Link
        href={href}
        onClick={onNavigate}
        className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition"
        style={{
          background: active ? TOK.accent : TOK.surface,
          border: `1px solid ${active ? TOK.accent : TOK.border}`,
          color: active ? TOK.accentOn : TOK.textPrimary,
        }}
        onMouseEnter={(e) => {
          if (!active) {
            e.currentTarget.style.borderColor = TOK.borderStrong;
            e.currentTarget.style.background = TOK.surfaceElevated;
          }
        }}
        onMouseLeave={(e) => {
          if (!active) {
            e.currentTarget.style.borderColor = TOK.border;
            e.currentTarget.style.background = TOK.surface;
          }
        }}
        title="See the four lenses' combined grade"
      >
        <Gauge
          size={14}
          style={{ color: active ? TOK.accentOn : TOK.accent }}
        />
        <span className="text-sm font-medium flex-1">Final grade</span>
      </Link>
    </div>
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
