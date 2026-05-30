"use client";

// Landing-page interactive area (v0.51 + v0.76 polish).
//
// Renders inside MarketingHome's hero when the visitor is logged in
// but hasn't analyzed anything yet. Two action surfaces:
//
//   • URL paste form (RepoInputForm) — primary action.
//   • Demo chips — secondary, "click to see RepoJury on a real repo
//     instantly without waiting for analysis".
//
// What's NOT here anymore (removed v0.76 polish):
//   • A "Your sessions" card. AdaptiveHome routes logged-in users
//     with 1+ sessions to WorkspaceHome, so the only time this panel
//     renders is when the caller has zero sessions — and an always-
//     empty card was hobby-chrome distracting from the actual
//     onboarding actions.
//   • The ownerId / hydrated state that filtered sessions for that
//     card. Sessions are bound to userId now (Better Auth); ownerId
//     was dead code on this surface.
//   • The animate-pulse first-visit nudge. The static line still
//     points at the demo chips, but the pulsing accent text read as
//     "tutorial overlay" rather than "first-time helper".
//
// First-visit hint persists in localStorage so it disappears after
// the visitor has clicked through once.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, Zap } from "lucide-react";
import { STYLE, TOK } from "@/lib/theme";
import { RepoInputForm, type DemoRepo } from "./RepoInputForm";

interface Props {
  demoRepos: DemoRepo[];
  /** v0.53: pre-analyzed demo sessions keyed by repoFullName. Demo
   *  buttons with a match navigate directly (instant load); buttons
   *  without one fall back to pre-filling the URL field for a fresh
   *  analysis. */
  demoSessions: Record<string, string>;
}

const HAS_VISITED_KEY = "gitvision:has-visited";

export function LandingPanel({ demoRepos, demoSessions }: Props) {
  const router = useRouter();
  const [value, setValue] = useState("");

  // First-visit nudge — quiet inline hint under the form pointing at
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
    dismissHint();
    // v0.53: instant demo path. If we have a pre-analyzed demo
    // session for this repo, navigate straight to it — no 20-second
    // wait, no fresh analysis. The session is read-only (ownerId
    // "demo" blocks the v0.26 ownership check on refresh) so the
    // visitor can explore but can't accidentally overwrite the demo.
    const sessionId = demoSessions[repo];
    if (sessionId) {
      router.push(`/session/${sessionId}`);
      return;
    }
    // Fallback: no pre-analyzed session yet. Pre-fill the URL field
    // and scroll/focus so the user can trigger a fresh analysis. This
    // path activates when DEMO_REPOS includes a repo we haven't yet
    // pre-analyzed and tagged with ownerId="demo".
    setValue(repo);
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(
        'input[placeholder^="github.com"]',
      );
      input?.focus();
      input?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <RepoInputForm
        value={value}
        onValueChange={setValue}
        onUserInteract={dismissHint}
      />

      {/* Demo chips — horizontal action row, no card frame. Compact
       *  by design: one line of chips at most viewports, wraps
       *  gracefully when narrow. */}
      <div className="flex flex-col gap-2.5">
        {showHint && (
          <div
            className="text-[11px] inline-flex items-center gap-1.5 self-start"
            style={{ color: TOK.textSecondary }}
          >
            <ArrowDown size={11} style={{ color: TOK.accent }} />
            First time? Click any of these to see RepoJury on a real
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
            const isInstant = !!demoSessions[item.repo];
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
                title={
                  isInstant
                    ? `${item.repo} — opens pre-analyzed session instantly`
                    : item.lang
                      ? `${item.repo} — ${item.lang} (will run a fresh analysis)`
                      : item.repo
                }
              >
                {isInstant && (
                  <Zap
                    size={10}
                    style={{ color: TOK.accent }}
                    aria-label="Instant — pre-analyzed"
                  />
                )}
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
    </div>
  );
}
