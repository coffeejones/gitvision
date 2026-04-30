"use client";

// Landing-page interactive area (v0.50).
//
// Wraps the URL paste form + a two-card row underneath:
//   • "Try a demo" — pre-analyzed repos showcasing the AST plugins.
//     Clicking a demo pre-fills the URL field above (which is
//     controlled state lifted into this component).
//   • "Your sessions" — owner-id-filtered list of saved sessions.
//     Reuses the same SessionRow component the workspace knows.
//
// Why a two-pane card layout instead of the v0.49 "demo row inline +
// sessions list below" shape: the workspace pivot (v0.42-v0.47) made
// the session pages feel like a tool, but the landing still read as
// a long marketing scroll. Two cards side-by-side mirrors the
// workspace's "two areas visible at once" feel and balances first-
// time visitors (who want to try a demo) with returning users (who
// want their sessions).
//
// Both cards always render — no click-to-expand. Hiding either path
// behind a click is friction; we want users to see both options at a
// glance.

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Beaker, Folder } from "lucide-react";
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

  // First-visit nudge — accent eyebrow ("Click any demo to start") in
  // the Try-a-demo card until the user does something meaningful.
  // Logic moved from RepoInputForm in v0.50 so the visual lives where
  // the action is.
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

  // Owner-id filter for "Your sessions". Mirrors the v0.26 logic from
  // HomeSessionsList — which we replace with this component's right
  // card.
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
    <div className="flex flex-col gap-8">
      <RepoInputForm
        value={value}
        onValueChange={setValue}
        onUserInteract={dismissHint}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Try a demo */}
        <PanelCard
          icon={<Beaker size={14} />}
          title="Try a demo"
          subtitle="Pre-analyzed across each AST plugin"
          accent={showHint}
        >
          {showHint && (
            <div
              className="text-[11px] mb-1.5 inline-flex items-center gap-1.5 self-start animate-pulse"
              style={{ color: TOK.accent }}
            >
              First time? Click any of these to see GitVision on a real
              codebase.
            </div>
          )}
          <ul className="flex flex-col gap-0.5">
            {demoRepos.map((entry) => {
              const item =
                typeof entry === "string" ? { repo: entry, lang: "" } : entry;
              return (
                <li key={item.repo}>
                  <button
                    onClick={() => pickDemo(item.repo)}
                    className="w-full flex items-center gap-2 py-1.5 px-2 rounded-md text-left transition group"
                    style={{ color: TOK.textSecondary }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = TOK.surfaceElevated;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <span
                      className="text-xs font-mono truncate flex-1"
                      style={{ color: TOK.textPrimary }}
                    >
                      {item.repo}
                    </span>
                    {item.lang && (
                      <span
                        className="text-[10px] shrink-0"
                        style={{ color: TOK.textMuted }}
                      >
                        {item.lang}
                      </span>
                    )}
                    <ArrowRight
                      size={11}
                      className="opacity-30 group-hover:opacity-100 transition shrink-0"
                      style={{ color: TOK.textSecondary }}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </PanelCard>

        {/* Your sessions */}
        <PanelCard
          icon={<Folder size={14} />}
          title="Your sessions"
          subtitle={
            visibleSessions.length === 0
              ? "Saved analyses appear here"
              : `${visibleSessions.length} saved${
                  hiddenCount > 0
                    ? ` · ${hiddenCount} from other browsers hidden`
                    : ""
                }`
          }
        >
          {visibleSessions.length === 0 ? (
            <div
              className="text-[11px] flex flex-col gap-1 py-2"
              style={{ color: TOK.textMuted }}
            >
              <div>No sessions yet.</div>
              <div>
                Paste a URL above or click any demo to start your first
                analysis.
              </div>
            </div>
          ) : (
            <ul className="flex flex-col gap-0.5 max-h-[280px] overflow-y-auto -mx-1">
              {visibleSessions.map((s, i) => (
                <li key={s.id}>
                  <Link
                    href={`/session/${s.id}`}
                    className="block rounded-md px-1 transition"
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = TOK.surfaceElevated;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <SessionRow
                      session={s}
                      isLast={i === visibleSessions.length - 1}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </PanelCard>
      </div>
    </div>
  );
}

interface PanelCardProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  /** Accent border when there's something the user should look at —
   *  e.g. the first-visit hint pulsing. */
  accent?: boolean;
  children: React.ReactNode;
}

function PanelCard({ icon, title, subtitle, accent, children }: PanelCardProps) {
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{
        background: TOK.surface,
        border: `1px solid ${accent ? `${TOK.accent}33` : TOK.border}`,
      }}
    >
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span style={{ color: accent ? TOK.accent : TOK.textSecondary }}>
            {icon}
          </span>
          <span
            className={STYLE.eyebrow}
            style={{ color: TOK.textPrimary }}
          >
            {title}
          </span>
        </div>
        <span className="text-[11px]" style={{ color: TOK.textMuted }}>
          {subtitle}
        </span>
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}
