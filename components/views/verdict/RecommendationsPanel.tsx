// "What to fix" — renders the deterministic, prioritized recommendations
// (lib/recommendations.ts) as the actionable payoff of the verdict page.
//
// Presentational only: the Recommendations object is computed server-side and
// passed in. Free for everyone (incl. logged-out demo viewers) — the advice is
// rule-based, not AI, so it sits outside the Plus gate, same as the verdict
// hero and the adoption read. The AI-polish layer (a later chunk) will rephrase
// these in prose for Plus; the grounded list itself stays free.
//
// Each card carries the signal's category (icon + label), effort, severity, and
// the repo-specific action + why — so the reader sees "what to do, on which
// files, and why" without leaving the page.

import {
  Activity,
  Check,
  FileText,
  FlaskConical,
  GitPullRequest,
  Network,
  Package,
  ShieldAlert,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { TOK } from "@/lib/sessionTheme";
import type {
  Recommendation,
  RecommendationCategory,
  Recommendations,
} from "@/lib/recommendations";

const CATEGORY_ICON: Record<RecommendationCategory, LucideIcon> = {
  security: ShieldAlert,
  dependencies: Package,
  tests: FlaskConical,
  architecture: Network,
  process: GitPullRequest,
  activity: Activity,
  docs: FileText,
};

const CATEGORY_LABEL: Record<RecommendationCategory, string> = {
  security: "Security",
  dependencies: "Dependencies",
  tests: "Tests",
  architecture: "Architecture",
  process: "Process",
  activity: "Activity",
  docs: "Docs",
};

/** Accent for the card — keyed off severity, rationed like the rest of the
 *  verdict UI (rose only on the worst, amber for the middle, muted for the
 *  soft "questions"-derived nudges). */
function accentFor(severity: Recommendation["severity"]): string {
  if (severity === "high") return TOK.rose;
  if (severity === "medium") return TOK.amber;
  if (severity === "low") return TOK.amber;
  return TOK.textMuted;
}

function RecommendationCard({ rec }: { rec: Recommendation }) {
  const Icon = CATEGORY_ICON[rec.category];
  const accent = accentFor(rec.severity);
  return (
    <article
      className="flex flex-col gap-3 rounded-xl p-5"
      style={{ background: TOK.surface, border: `1px solid ${TOK.border}` }}
    >
      <div className="flex items-start gap-3">
        <div
          className="shrink-0 rounded-lg p-2 flex items-center justify-center"
          style={{ background: `${accent}1a`, border: `1px solid ${accent}33` }}
        >
          <Icon size={15} style={{ color: accent }} />
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <h3
            className="text-[15px] font-semibold leading-snug"
            style={{ color: TOK.textPrimary, letterSpacing: "-0.01em" }}
          >
            {rec.title}
          </h3>
          <div
            className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em]"
            style={{ color: TOK.textMuted }}
          >
            <span>{CATEGORY_LABEL[rec.category]}</span>
            <span aria-hidden>·</span>
            <span>{rec.effort}</span>
            {rec.severity && (
              <>
                <span aria-hidden>·</span>
                <span style={{ color: accent }}>{rec.severity}</span>
              </>
            )}
          </div>
        </div>
      </div>

      <p
        className="text-[14px] leading-relaxed"
        style={{ color: TOK.textSecondary }}
      >
        {rec.action}
      </p>

      <p
        className="text-[13px] leading-relaxed"
        style={{ color: TOK.textMuted }}
      >
        <span style={{ color: TOK.textSecondary }}>Why:</span> {rec.why}
      </p>
    </article>
  );
}

export function RecommendationsPanel({
  recommendations,
  narrative,
}: {
  recommendations: Recommendations;
  /** Optional Plus-tier AI "where to start" lead-in. Null for free/anonymous
   *  viewers — the deterministic cards below carry the section on their own. */
  narrative?: { text: string; model: string } | null;
}) {
  const { items } = recommendations;
  return (
    <section className="flex flex-col gap-4" aria-label="What to fix">
      <div className="flex flex-col gap-1">
        <span
          className="text-[10px] uppercase tracking-[0.2em] font-medium"
          style={{ color: TOK.textMuted }}
        >
          What to fix
        </span>
        <p className="text-sm" style={{ color: TOK.textSecondary }}>
          {items.length > 0
            ? "Specific, prioritized actions — each grounded in a signal above, highest-impact first."
            : "Nothing urgent surfaced — the deterministic checks didn't flag anything to fix right now."}
        </p>
      </div>

      {narrative && items.length > 0 && (
        <div
          className="flex flex-col gap-2 rounded-xl p-5"
          style={{
            background: TOK.surfaceElevated,
            border: `1px solid ${TOK.border}`,
          }}
        >
          <div
            className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em]"
            style={{ color: TOK.textMuted }}
          >
            <Sparkles size={11} style={{ color: TOK.accent }} />
            <span>Where to start · grounded in the actions below</span>
          </div>
          <p
            className="text-[14.5px] leading-relaxed whitespace-pre-wrap"
            style={{ color: TOK.textPrimary }}
          >
            {narrative.text}
          </p>
        </div>
      )}

      {items.length === 0 ? (
        <div
          className="flex items-center gap-2.5 rounded-xl p-5 text-sm"
          style={{
            background: TOK.surface,
            border: `1px solid ${TOK.border}`,
            color: TOK.textSecondary,
          }}
        >
          <Check size={16} style={{ color: TOK.accent, flexShrink: 0 }} />
          A clean bill on the automated checks. Keep the positive signals up.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((rec) => (
            <RecommendationCard key={rec.id} rec={rec} />
          ))}
        </div>
      )}
    </section>
  );
}
