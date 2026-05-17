"use client";

// Session search palette for the home / workspace surface.
//
// Different domain from CommandPalette.tsx — that one navigates
// inside a single session (pages / files / functions). This one
// searches ACROSS the visitor's sessions on the landing page. The
// shared visual language (modal, backdrop blur, input + footer
// shortcuts) keeps the keyboard-power-user mental model consistent.
//
// Triggered by ⌘K / Ctrl+K from AdaptiveHome's keyboard listener.
// Filters by repo full-name + custom session name. Enter or click
// navigates to /session/<id>; Esc closes; ↑ ↓ navigate.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GitBranch, Search } from "lucide-react";
import { TOK } from "@/lib/theme";
import type { SessionSummary } from "@/lib/types";

interface Props {
  sessions: SessionSummary[];
  open: boolean;
  onClose: () => void;
}

const VISIBLE_LIMIT = 30; // cap rendered rows — keeps the palette snappy

export function SessionSearchPalette({ sessions, open, onClose }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter — case-insensitive match against repoFullName + name.
  // Empty query shows the most recent N (sessions array is already
  // sorted by recency on the landing page).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions.slice(0, VISIBLE_LIMIT);
    return sessions
      .filter((s) => {
        const hay = `${s.repoFullName} ${s.name}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, VISIBLE_LIMIT);
  }, [sessions, query]);

  // Reset highlight when filter narrows.
  useEffect(() => {
    setHighlight(0);
  }, [query]);

  // Auto-focus the input when the palette opens. Reset state on close
  // so reopening starts from a clean slate.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    } else {
      setQuery("");
      setHighlight(0);
    }
  }, [open]);

  // Esc to close — handled at document level so the modal closes
  // even if focus has wandered out of the input.
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

  function activate(s: SessionSummary) {
    router.push(`/session/${s.id}`);
    onClose();
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
        {/* Search input row */}
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
            placeholder="Search your sessions by repo or name…"
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

        {/* Results list */}
        <div className="max-h-[60vh] overflow-y-auto py-1">
          {filtered.length === 0 && (
            <div
              className="px-4 py-6 text-sm text-center"
              style={{ color: TOK.textMuted }}
            >
              No sessions match &ldquo;{query}&rdquo;.
            </div>
          )}
          {filtered.map((s, idx) => (
            <SessionRow
              key={s.id}
              session={s}
              active={idx === highlight}
              onClick={() => activate(s)}
            />
          ))}
          {filtered.length === VISIBLE_LIMIT && (
            <div
              className="px-4 pt-2 pb-1 text-[11px] text-center"
              style={{ color: TOK.textMuted }}
            >
              Showing first {VISIBLE_LIMIT} matches. Narrow your search
              to see fewer.
            </div>
          )}
        </div>

        {/* Footer keyboard hints */}
        <div
          className="flex items-center gap-3 px-4 py-2 text-[10px]"
          style={{
            borderTop: `1px solid ${TOK.border}`,
            color: TOK.textMuted,
          }}
        >
          <span>↑ ↓ to navigate</span>
          <span>↵ to open</span>
          <span>esc to close</span>
          <span className="ml-auto font-mono">⌘K · Ctrl+K</span>
        </div>
      </div>
    </div>
  );
}

interface RowProps {
  session: SessionSummary;
  active: boolean;
  onClick: () => void;
}

function SessionRow({ session, active, onClick }: RowProps) {
  // Format relative-ish timestamp for the secondary info chunk.
  // Cheap heuristic — not a full date-fns dependency for what is
  // essentially a search affordance.
  const updated = formatRelative(session.updatedAt);

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full px-4 py-2.5 flex items-center gap-3 text-left transition"
      style={{
        background: active ? TOK.surfaceElevated : "transparent",
      }}
    >
      <GitBranch
        size={13}
        style={{
          color: active ? TOK.accent : TOK.textMuted,
          flexShrink: 0,
        }}
      />
      <div className="flex flex-col min-w-0 flex-1">
        <span
          className="text-sm font-medium truncate"
          style={{ color: TOK.textPrimary }}
        >
          {session.repoFullName}
        </span>
        {session.name !== session.repoFullName && (
          <span
            className="text-xs truncate"
            style={{ color: TOK.textMuted }}
          >
            {session.name}
          </span>
        )}
      </div>
      <span
        className="text-[11px] font-mono shrink-0"
        style={{ color: TOK.textMuted }}
      >
        {session.snapshotCount} snap{session.snapshotCount === 1 ? "" : "s"}
        {" · "}
        {updated}
      </span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// Tiny relative-time formatter — good enough for "5m ago" style
// in a search affordance. Not exposed elsewhere yet; inline so we
// don't drag in a real date utility for one usage.
// ─────────────────────────────────────────────────────────────
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return "just now";
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(mo / 12);
  return `${yr}y ago`;
}
