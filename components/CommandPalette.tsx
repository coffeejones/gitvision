"use client";

// Cmd+K command palette (v0.47).
//
// Workspace-defining feature: instead of "click sidebar → click file
// picker → search" you press Cmd+K from anywhere and type the file
// name. Linear / Raycast / Sublime CmdShift+P pattern.
//
// What's searchable:
//   - Workspace pages — every sidebar destination across the four
//     departments (Health: Overview/Insights/Signals · Security ·
//     Forensics: Flows/Refactor/Faultline/Test quality/Architecture/
//     Canvas/Code/Source/Imports · Supply: Packages/PRs), plus the
//     Final grade pin. Listed in sidebar order so muscle memory
//     transfers.
//
//     This list is hand-maintained and drifted: it said "all 10 tabs"
//     while Forensics had grown from 4 entries to 9, and Faultline and
//     Source were in the sidebar with no way to reach them by Cmd+K.
//     lib/__tests__/sessionNavLockstep.test.ts now fails when the two
//     lists disagree, so the next tab cannot be added to only one.
//   - Files from the code graph's file-complexity index — top 200 to keep
//     the search index small; substring match on path
//   - Functions from the code graph — top 200 by complexity; substring
//     match on name OR `${containerType}.${name}` so "Blueprint.add"
//     finds Blueprint.add_url_rule
//
//     Both lists arrive prebuilt from the server (lib/clientSnapshot.ts).
//     Sorting and slicing them HERE meant the whole code graph had to be
//     serialized to the browser to pick 400 items out of it.
//
// Picking a file navigates to /code?file=<path>; picking a function
// navigates to /code?file=<path>&fn=<name>&container=<type>. Both
// route through the v0.37 deep-link mechanism in CodePanel so
// selection-on-arrival just works.
//
// Keyboard:
//   Cmd+K / Ctrl+K     toggle palette
//   Esc                close
//   ↑ / ↓              move highlight
//   Enter              activate
//   anything else      type into search

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Boxes,
  Code as CodeIcon,
  FileCode,
  FileText,
  Gauge,
  GitPullRequest,
  Hash,
  HelpCircle,
  Home,
  ListChecks,
  Network,
  FlaskConical,
  Package,
  Search,
  Shield,
  ShieldAlert,
  Route,
  Sparkles,
  Zap,
} from "lucide-react";
import type { PaletteIndex } from "@/lib/clientSnapshot";
import { STYLE, TOK } from "@/lib/sessionTheme";

interface Props {
  sessionId: string;
  /** Prebuilt on the server (lib/clientSnapshot.ts) — already sorted and capped.
   *  Null when the snapshot has no code graph, in which case only pages are
   *  searchable. Taking an index rather than a snapshot is what keeps the graph
   *  off the wire. */
  index: PaletteIndex | null;
  /** Controlled by the parent. The shell owns the open state so a
   *  separate "Search…" trigger button in the sidebar can open the
   *  palette without poking at internal state. */
  open: boolean;
  onClose: () => void;
}

interface PaletteItem {
  id: string;
  group: "pages" | "files" | "functions";
  label: string;
  /** Secondary text shown muted below or beside the label. */
  hint?: string;
  icon: React.ReactNode;
  /** What to do on Enter / click. Returns the URL to navigate to. */
  href: string;
}

const VISIBLE_PER_GROUP = 6;

export function CommandPalette({ sessionId, index, open, onClose }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Build the searchable index once per snapshot. Top-N caps keep the
  // index from blowing up on golang/go-sized repos (22k functions).
  const allItems = useMemo<PaletteItem[]>(() => {
    const base = `/session/${sessionId}`;
    const pages: PaletteItem[] = [
      // Health
      { id: "p:brief", group: "pages", label: "Choose a subject", icon: <HelpCircle size={13} />, href: `${base}/brief/security` },
      { id: "p:overview", group: "pages", label: "Overview", icon: <Home size={13} />, href: base },
      { id: "p:insights", group: "pages", label: "Insights", icon: <Sparkles size={13} />, href: `${base}/insights` },
      { id: "p:signals", group: "pages", label: "Signals", icon: <ListChecks size={13} />, href: `${base}/signals` },
      // Security
      { id: "p:security", group: "pages", label: "Security", icon: <Shield size={13} />, href: `${base}/security` },
      // Forensics
      { id: "p:flows", group: "pages", label: "Flows", icon: <Route size={13} />, href: `${base}/flows` },
      { id: "p:refactor", group: "pages", label: "Refactor", icon: <ShieldAlert size={13} />, href: `${base}/refactor` },
      { id: "p:faultline", group: "pages", label: "Faultline", icon: <Zap size={13} />, href: `${base}/faultline` },
      { id: "p:testquality", group: "pages", label: "Test quality", icon: <FlaskConical size={13} />, href: `${base}/testquality` },
      { id: "p:architecture", group: "pages", label: "Architecture", icon: <Boxes size={13} />, href: `${base}/architecture` },
      { id: "p:canvas", group: "pages", label: "Canvas", icon: <Network size={13} />, href: `${base}/canvas` },
      { id: "p:code", group: "pages", label: "Code", icon: <CodeIcon size={13} />, href: `${base}/code` },
      { id: "p:source", group: "pages", label: "Source", icon: <FileText size={13} />, href: `${base}/source` },
      { id: "p:imports", group: "pages", label: "Imports", icon: <FileCode size={13} />, href: `${base}/imports` },
      // Supply
      { id: "p:packages", group: "pages", label: "Packages", icon: <Package size={13} />, href: `${base}/packages` },
      { id: "p:prs", group: "pages", label: "PRs", icon: <GitPullRequest size={13} />, href: `${base}/prs` },
      // Final grade — climax page; lives outside the departments
      // grouping but is still a navigable workspace destination.
      { id: "p:verdict", group: "pages", label: "Final grade", icon: <Gauge size={13} />, href: `${base}/verdict` },
    ];

    if (!index) return pages;

    // The sort and the caps moved to lib/clientSnapshot.ts, because doing them
    // here meant shipping the whole code graph to the browser to pick 400 items
    // out of it. What arrives is already ordered and already sliced.
    const files: PaletteItem[] = index.files.map(({ path, complexity }) => ({
      id: `f:${path}`,
      group: "files",
      label: path,
      hint: `complexity ${complexity}`,
      icon: <FileCode size={13} />,
      href: `${base}/code?file=${encodeURIComponent(path)}`,
    }));

    const functions: PaletteItem[] = index.functions.map((fn) => {
      const display = fn.containerType ? `${fn.containerType}.${fn.name}` : fn.name;
      const params = new URLSearchParams({ file: fn.filePath, fn: fn.name });
      if (fn.containerType) params.set("container", fn.containerType);
      return {
        id: `fn:${fn.filePath}:${fn.containerType ?? ""}:${fn.name}`,
        group: "functions",
        label: display,
        hint: `${fn.filePath} · complexity ${fn.complexity}`,
        icon: <Hash size={13} />,
        href: `${base}/code?${params.toString()}`,
      };
    });

    return [...pages, ...files, ...functions];
  }, [sessionId, index]);

  // Filter against the query — case-insensitive substring match
  // against label + hint. Reasonable for alpha; fuzzy ranking
  // (Sublime / VS Code style) is a possible v2 upgrade.
  const filtered = useMemo<PaletteItem[]>(() => {
    if (!query) {
      // Empty query — show first few of each group, in order:
      // pages first (always relevant), then a sample of files +
      // functions so users can scan what's available.
      const byGroup: Record<string, PaletteItem[]> = {
        pages: [],
        files: [],
        functions: [],
      };
      for (const item of allItems) {
        if (byGroup[item.group].length < VISIBLE_PER_GROUP) {
          byGroup[item.group].push(item);
        }
      }
      return [...byGroup.pages, ...byGroup.files, ...byGroup.functions];
    }
    const q = query.toLowerCase();
    return allItems
      .filter((item) => {
        if (item.label.toLowerCase().includes(q)) return true;
        if (item.hint?.toLowerCase().includes(q)) return true;
        return false;
      })
      .slice(0, 50);
  }, [allItems, query]);

  // Reset highlight when filter changes — keeps the highlighted item
  // from drifting off-list as the user types.
  useEffect(() => {
    setHighlight(0);
  }, [query]);

  // Auto-focus the input when the palette opens. Without this users
  // would have to click into the input box, which defeats the purpose.
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      // Reset on close so reopening starts fresh.
      setQuery("");
      setHighlight(0);
    }
  }, [open]);

  // Esc closes inside the palette. Cmd+K toggle lives in SessionShell
  // because it has to work regardless of whether the palette is mounted.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function activate(item: PaletteItem) {
    onClose();
    router.push(item.href);
  }

  function onListKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[highlight];
      if (item) activate(item);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4"
      style={{ background: "rgba(10, 10, 14, 0.65)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-xl shadow-2xl flex flex-col overflow-hidden"
        style={{
          background: TOK.surface,
          border: `1px solid ${TOK.borderStrong}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center gap-2.5 px-4 h-12"
          style={{ borderBottom: `1px solid ${TOK.border}` }}
        >
          <Search size={14} style={{ color: TOK.textMuted }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onListKey}
            placeholder="Jump to a page, file, or function…"
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: TOK.textPrimary }}
          />
          <span
            className="text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0"
            style={{
              background: TOK.surfaceElevated,
              color: TOK.textMuted,
              border: `1px solid ${TOK.border}`,
            }}
          >
            esc
          </span>
        </div>

        <div className="max-h-[60vh] overflow-y-auto py-1">
          {filtered.length === 0 && (
            <div
              className="px-4 py-6 text-sm text-center"
              style={{ color: TOK.textMuted }}
            >
              No matches.
            </div>
          )}
          {renderGrouped(filtered, highlight, activate)}
        </div>

        <div
          className="flex items-center gap-3 px-4 py-2 text-[10px]"
          style={{
            borderTop: `1px solid ${TOK.border}`,
            color: TOK.textMuted,
          }}
        >
          <span>↑ ↓ to navigate</span>
          <span>↵ to select</span>
          <span>esc to close</span>
          <span className="ml-auto font-mono">Cmd+K</span>
        </div>
      </div>
    </div>
  );
}

const GROUP_LABELS: Record<PaletteItem["group"], string> = {
  pages: "Pages",
  files: "Files",
  functions: "Functions",
};

function renderGrouped(
  items: PaletteItem[],
  highlight: number,
  activate: (item: PaletteItem) => void
) {
  // Walk the filtered list once, emitting a group heading whenever
  // the group changes. Index across the flat list drives the highlight,
  // so the heading rows don't consume an index slot.
  const blocks: React.ReactNode[] = [];
  let lastGroup: PaletteItem["group"] | null = null;
  items.forEach((item, idx) => {
    if (item.group !== lastGroup) {
      blocks.push(
        <div
          key={`g:${item.group}:${idx}`}
          className={`px-4 pt-3 pb-1 ${STYLE.eyebrow}`}
          style={{ color: TOK.textMuted }}
        >
          {GROUP_LABELS[item.group]}
        </div>
      );
      lastGroup = item.group;
    }
    blocks.push(
      <PaletteRow
        key={item.id}
        item={item}
        active={idx === highlight}
        onClick={() => activate(item)}
      />
    );
  });
  return blocks;
}

function PaletteRow({
  item,
  active,
  onClick,
}: {
  item: PaletteItem;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = TOK.surfaceElevated;
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
      className="w-full flex items-center gap-3 px-4 py-2 text-left transition"
      style={{
        background: active ? TOK.surfaceElevated : "transparent",
        color: TOK.textPrimary,
      }}
    >
      <span
        style={{ color: active ? TOK.accent : TOK.textMuted }}
      >
        {item.icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-mono truncate">{item.label}</div>
        {item.hint && (
          <div
            className="text-[11px] truncate"
            style={{ color: TOK.textMuted }}
          >
            {item.hint}
          </div>
        )}
      </div>
    </button>
  );
}
