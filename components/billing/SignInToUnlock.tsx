// Sign-in nudge for FREE features a logged-out visitor lands on.
//
// In the free-phase (see lib/pricing.ts) the analysis toolset — AI briefing,
// architecture, Faultline, test-quality, refactor guidance, private repos — is
// free on every tier. A signed-in visitor of any tier passes the gate, so the
// only viewer who hits a "locked" state is one who isn't signed in (e.g.
// following a shared link to a public session). We nudge them to sign in — free
// — rather than upsell a paid plan. UpgradePrompt is still the right component
// for genuinely paid features (SBOM export, team, etc.).
//
// Server-safe (no hooks): the caller passes redirectTo so auth returns the
// visitor to the exact tab they were on.

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { TOK } from "@/lib/sessionTheme";

interface Props {
  /** What the visitor tried to open — appears in the headline. */
  featureName: string;
  /** Optional context line above the headline. */
  context?: string;
  /** Path to return to after auth (e.g. /session/{id}/faultline). */
  redirectTo: string;
}

export function SignInToUnlock({ featureName, context, redirectTo }: Props) {
  const next = encodeURIComponent(redirectTo);
  return (
    <section
      className="rounded-xl p-8 flex flex-col gap-6 max-w-2xl mx-auto"
      style={{
        background: `linear-gradient(135deg, ${TOK.surfaceElevated} 0%, ${TOK.surface} 60%)`,
        border: `1px solid ${TOK.border}`,
        boxShadow:
          "0 1px 2px rgba(0, 0, 0, 0.15), 0 8px 24px -12px rgba(0, 0, 0, 0.35)",
      }}
    >
      {/* Header — sparkle (not a lock: nothing is being withheld, it's free) */}
      <header className="flex items-start gap-4">
        <div
          className="rounded-lg p-3 flex items-center justify-center flex-shrink-0"
          style={{
            background: "rgba(255, 255, 255, 0.04)",
            border: `1px solid ${TOK.border}`,
          }}
        >
          <Sparkles size={20} style={{ color: TOK.accent }} />
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <span
            className="text-[10px] uppercase tracking-[0.18em] font-medium"
            style={{ color: TOK.textMuted }}
          >
            Free with any account
          </span>
          {context && (
            <p
              className="text-sm leading-relaxed"
              style={{ color: TOK.textMuted }}
            >
              {context}
            </p>
          )}
          <h2
            className="text-2xl font-semibold tracking-tight"
            style={{
              color: TOK.textPrimary,
              letterSpacing: "-0.02em",
              lineHeight: 1.15,
            }}
          >
            Sign in to open {featureName}{" "}— it&apos;s free.
          </h2>
        </div>
      </header>

      {/* CTAs — sign in or create a free account, both returning to this tab */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
        <Link
          href={`/login?next=${next}`}
          className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-lg text-sm font-medium transition hover:opacity-90"
          style={{ background: TOK.textPrimary, color: TOK.bg }}
        >
          Sign in — it&apos;s free
          <ArrowRight size={14} />
        </Link>
        <Link
          href={`/signup?next=${next}`}
          className="inline-flex items-center justify-center h-11 px-5 rounded-lg text-sm font-medium transition hover:bg-white/5"
          style={{
            color: TOK.textSecondary,
            border: `1px solid rgba(255, 255, 255, 0.1)`,
          }}
        >
          Create a free account
        </Link>
      </div>
    </section>
  );
}
