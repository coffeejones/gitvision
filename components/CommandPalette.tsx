"use client";

// Cmd+K command palette (v0.47).
//
// Workspace-defining feature: instead of "click sidebar → click file
// picker → search" you press Cmd+K from anywhere and type the file
// name. Linear / Raycast / Sublime CmdShift+P pattern.
//
// What's searchable:
//   - Workspace pages — all 10 tabs across the four departments
//     (Health: Overview/Insights/Signals · Security · Forensics:
//     Architecture/Canvas/Code/Imports · Supply: Packages/PRs).
//     Listed in sidebar order so muscle memory transfers.
//   - Files in the snapshot's file-complexity index (Code tab data) —
//     top 200 to keep the search index small; substring match on path
//   - Functions from the codeGraph — top 200 by complexity; substring
//     match on name OR `${containerType}.${name}` so "Blueprint.add"
//     finds Blueprint.add_url_rule
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
  GitPullRequest,
  Hash,
  Home,
  ListChecks,
  Network,
  Package,
  Search,
  Shield,
  Sparkles,
} from "lucide-react";
import type { AnalysisSnapshot } from "@/lib/types";
import { STYLE, TOK } from "@/lib/theme";

interface Props {
  sessionId: string;
  snapshot: AnalysisSnapshot;
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

const MAX_FILES = 200;
const MAX_FUNCTIONS = 200;
const VISIBLE_PER_GROUP = 6;

export function CommandPalette({ sessionId, snapshot, open, onClose }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Build the searchable index once per snapshot. Top-N caps keep the
  // index from blowing up on golang/go-sized repos (22k functions).
  const allItems = useMemo<PaletteItem[]>(() => {
    const base = `/session/${sessionId}`;
    const pages: PaletteItem[] = [
      // Health Department
      { id: "p:overview", group: "pages", label: "Overview", icon: <Home size={13} />, href: base },
      { id: "p:insights", group: "pages", label: "Insights", icon: <Sparkles size={13} />, href: `${base}/insights` },
      { id: "p:signals", group: "pages", label: "Signals", icon: <ListChecks size={13} />, href: `${base}/signals` },
      // Security Bureau
      { id: "p:security", group: "pages", label: "Security", icon: <Shield size={13} />, href: `${base}/security` },
      // Forensics Lab
      { id: "p:architecture", group: "pages", label: "Architecture", icon: <Boxes size={13} />, href: `${base}/architecture` },
      { id: "p:canvas", group: "pages", label: "Canvas", icon: <Network size={13} />, href: `${base}/canvas` },
      { id: "p:code", group: "pages", label: "Code", icon: <CodeIcon size={13} />, href: `${base}/code` },
      { id: "p:imports", group: "pages", label: "Imports", icon: <FileCode size={13} />, href: `${base}/imports` },
      // Supply Office
      { id: "p:packages", group: "pages", label: "Packages", icon: <Package size={13} />, href: `${base}/packages` },
      { id: "p:prs", group: "pages", label: "PRs", icon: <GitPullRequest size={13} />, href: `${base}/prs` },
    ];

    const cg = snapshot.codeGraph;
    if (!cg) return pages;

    // Top files by complexity. Capped at MAX_FILES so monorepos like
    // golang/go don't make every keystroke filter through 6000 paths.
    const files: PaletteItem[] = Object.entries(cg.fileComplexity)
      .sort(([, a], [, b]) => b - a)
      .slice(0, MAX_FILES)
      .map(([file, complexity]) => ({
        id: `f:${file}`,
        group: "files",
        label: file,
        hint: `complexity ${complexity}`,
        icon: <FileCode size={13} />,
        href: `${base}/code?file=${encodeURIComponent(file)}`,
      }));

    const functions: PaletteItem[] = [...cg.functions]
      .sort((a, b) => b.complexity - a.complexity)
      .slice(0, MAX_FUNCTIONS)
      .map((fn) => {
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
  }, [sessionId, snapshot]);

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
