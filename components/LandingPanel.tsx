"use client";

// Landing-page interactive area (v0.50, reshaped in v0.51).
//
// Wraps the URL paste form, a compact horizontal demo-chip row, and a
// full-width "Your sessions" card. The v0.50 attempt at two
// side-by-side cards looked workspace-y but cramped both lists into
// ~480px columns — sessions got truncated, demos felt over-framed for
// what's really a 4-button action row. v0.51 splits the two by intent:
//
//   • Demos = action shortcuts → inline horizontal chips, no card
//     frame. They're a "click to start" surface, not saved content.
//   • Sessions = saved state → full-width card with eyebrow header,
//     enough horizontal space for SessionRow to breathe.
//
// First-visit hint and chip styling preserved from the v0.50
// implementation; only the layout changes.

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDown, Folder } from "lucide-react";
import type { SessionSummary } from "@/lib/types";
import { filterSessionsByOwner, getOrCreateOwnerId } from "@/lib/ownerId";
import { STYLE, TOK } from "@/lib/theme";
import { RepoInputForm, type DemoRepo } from "./RepoInputForm";
import { SessionRow } from "./SessionRow";

interface Props {
  demoRepos: DemoRepo[];
  initialSessions: SessionSummary[];
}

const HAS_VISITED_KEY = "gitvision:has-visited";

export function LandingPanel({ demoRepos, initialSessions }: Props) {
  const [value, setValue] = useState("");

  // First-visit nudge — accent text under the form that points to
  // the demo chips. Persists in localStorage so returning visitors
  // don't see it.
  const [showHint, setShowHint] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem(HAS_VISITED_KEY)) setShowHint(true);
    } catch {
      /* localStorage unavailable — skip the nudge silently */
    }
  }, []);
  function dismissHint() {
    setShowHint(false);
    try {
      localStorage.setItem(HAS_VISITED_KEY, "1");
    } catch {
      /* no-op */
    }
  }

  function pickDemo(repo: string) {
    setValue(repo);
    dismissHint();
    // Scroll the form into view + focus its input. The repo gets
    // pre-filled; the user clicks Analyze themselves so they retain
    // the option to add a subdir for monorepos.
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(
        'input[placeholder^="github.com"]'
      );
      input?.focus();
      input?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  // Owner-id filter for "Your sessions". Mirrors the v0.26 logic
  // from the deleted HomeSessionsList.
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setOwnerId(getOrCreateOwnerId());
    setHydrated(true);
  }, []);

  const visibleSessions = !hydrated
    ? initialSessions
    : filterSessionsByOwner(initialSessions, ownerId);
  const hiddenCount = initialSessions.length - visibleSessions.length;

  return (
    <div className="flex flex-col gap-7">
      <RepoInputForm
        value={value}
        onValueChange={setValue}
        onUserInteract={dismissHint}
      />

      {/* Demo chips — horizontal action row, no card frame. Compact
       *  by design: one line of chips at most viewports, wraps
       *  gracefully when narrow. */}
      <div className="flex flex-col gap-2">
        {showHint && (
          <div
            className="text-[11px] inline-flex items-center gap-1.5 self-start animate-pulse"
            style={{ color: TOK.accent }}
          >
            <ArrowDown size={11} />
            First time? Click any of these to see GitVision on a real
            codebase.
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={STYLE.eyebrow}
            style={{ color: TOK.textMuted }}
          >
            Try a demo
          </span>
          {demoRepos.map((entry) => {
            const item =
              typeof entry === "string" ? { repo: entry, lang: "" } : entry;
            return (
              <button
                key={item.repo}
                onClick={() => pickDemo(item.repo)}
                className="text-xs font-mono px-2.5 py-1 rounded-md transition flex items-center gap-1.5"
                style={{
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
                title={item.lang ? `${item.repo} — ${item.lang}` : item.repo}
              >
                <span>{item.repo}</span>
                {item.lang && (
                  <span
                    className="text-[10px]"
                    style={{ color: TOK.textMuted }}
                  >
                    · {item.lang}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Your sessions — full-width card. Workspace-style: eyebrow
       *  header with subtitle on the right, list of SessionRow inside.
       *  Variable content (0 to many sessions) gets full ~5xl width
       *  to breathe instead of being squeezed into half a column. */}
      <div
        className="rounded-xl flex flex-col"
        style={{
          background: TOK.surface,
          border: `1px solid ${TOK.border}`,
        }}
      >
        <div
          className="flex items-baseline justify-between gap-2 px-5 py-3 flex-wrap"
          style={{ borderBottom: `1px solid ${TOK.border}` }}
        >
          <div className="flex items-center gap-2">
            <Folder size={14} style={{ color: TOK.textSecondary }} />
            <span
              className={STYLE.eyebrow}
              style={{ color: TOK.textPrimary }}
            >
              Your sessions
            </span>
          </div>
          <span className="text-[11px]" style={{ color: TOK.textMuted }}>
            {visibleSessions.length === 0
              ? "Saved analyses appear here"
              : `${visibleSessions.length} saved${
                  hiddenCount > 0
                    ? ` · ${hiddenCount} from other browsers hidden`
                    : ""
                }`}
          </span>
        </div>

        {visibleSessions.length === 0 ? (
          <div
            className="text-sm flex flex-col gap-1 px-5 py-6 text-center"
            style={{ color: TOK.textMuted }}
          >
            <div>No sessions yet.</div>
            <div className="text-[11px]">
              Paste a URL above or click any demo to start your first
              analysis.
            </div>
          </div>
        ) : (
          <div className="flex flex-col">
            {visibleSessions.map((s, i) => (
              <Link key={s.id} href={`/session/${s.id}`} className="block">
                <SessionRow
                  session={s}
                  isLast={i === visibleSessions.length - 1}
                />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
