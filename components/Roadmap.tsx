// Public roadmap section — shared between MarketingHome and
// WorkspaceHome.
//
// Two columns:
//   - "What's new": recently-shipped items with month/year tags in
//     the accent color. Proves momentum to new visitors and gives
//     returning users a "what changed since I was last here" view.
//   - "What's coming": upcoming roadmap items with status tags
//     (Next / Soon / Planned / Future) in muted styling. Sets
//     expectations without committing to dates.
//
// Each list is a hand-curated subset of PROGRESS.md's "Shipped" and
// "Next up" sections — picked for outsider-readability, not for
// version-by-version completeness. Update as we ship.
//
// Anchored via id="roadmap" + scroll-mt-20 so the MarketingNav's
// "What's new" link lands the section header below the sticky bar
// instead of behind it.

import { Calendar, Sparkles } from "lucide-react";
import { STYLE, TOK } from "@/lib/theme";

interface RoadmapItem {
  tag: string;
  title: string;
  description: string;
}

const SHIPPED: RoadmapItem[] = [
  {
    tag: "May 2026",
    title: "Accounts + workspace",
    description:
      "Sign up with email or GitHub. Sessions tied to your account, accessible from any device. Connect GitHub from /account to link both sign-in methods.",
  },
  {
    tag: "May 2026",
    title: "RepoJury PR-bot",
    description:
      "One grounded review comment on every PR. Same signal layer as the workspace, zero LLM cost.",
  },
  {
    tag: "May 2026",
    title: "Architecture diagrams",
    description:
      "Class diagrams auto-generated from your repo's AST. Across 7 languages, no manual UML, no setup.",
  },
  {
    tag: "May 2026",
    title: "Near-duplicate detection",
    description:
      "AST-hash structural matching. Caught 36 ARM-rewrite copies in golang/go src/cmd.",
  },
];

const COMING: RoadmapItem[] = [
  {
    tag: "Next",
    title: "Email verification",
    description:
      "Verify your email + recover forgotten passwords via Resend. GitHub OAuth currently works as the recovery path.",
  },
  {
    tag: "Soon",
    title: "Pre-PR self-review",
    description:
      "Same signals, on your local branch, before the diff goes public. \"Check this before you push.\"",
  },
  {
    tag: "Soon",
    title: "Cross-PR trend analytics",
    description:
      "Complexity, coverage, and hotspot trends across snapshots — see where your codebase is drifting.",
  },
  {
    tag: "Planned",
    title: "Private repos",
    description:
      "Analyze private repos via per-account GitHub permissions. Auth layer is in place; permission model is the missing piece.",
  },
];

export function Roadmap() {
  return (
    <section id="roadmap" className="flex flex-col gap-6 scroll-mt-20">
      <div className="flex items-baseline justify-between">
        <h2 className={STYLE.sectionTitle}>Roadmap</h2>
        <div className="text-xs" style={{ color: TOK.textMuted }}>
          what we shipped, what&apos;s coming next
        </div>
      </div>

      {/* Two columns as discrete cards (not gap-px table cells) — same
       *  recipe as the "What you'll find" grid on MarketingHome so the
       *  whole page reads as one design system. Each column carries
       *  its own border + rounded corners, with `gap-4` between them. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* What's new — accent eyebrow signals "shipped" */}
        <div
          className="p-6 flex flex-col gap-4 rounded-xl"
          style={{
            background: TOK.bg,
            border: `1px solid ${TOK.border}`,
          }}
        >
          <div className="flex items-center gap-2">
            <Sparkles size={14} style={{ color: TOK.accent }} />
            <span
              className="text-xs uppercase tracking-[0.18em] font-medium"
              style={{ color: TOK.accent }}
            >
              What&apos;s new
            </span>
          </div>
          <ul className="flex flex-col gap-3.5">
            {SHIPPED.map((item) => (
              <li key={item.title} className="flex items-start gap-3">
                <span
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 mt-0.5 text-center min-w-[4.5rem]"
                  style={{
                    background: TOK.accentSoft,
                    color: TOK.accent,
                  }}
                >
                  {item.tag}
                </span>
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span
                    className="text-sm font-medium"
                    style={{ color: TOK.textPrimary }}
                  >
                    {item.title}
                  </span>
                  <span
                    className="text-xs leading-relaxed"
                    style={{ color: TOK.textSecondary }}
                  >
                    {item.description}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* What's coming — muted eyebrow signals "future" */}
        <div
          className="p-6 flex flex-col gap-4 rounded-xl"
          style={{
            background: TOK.bg,
            border: `1px solid ${TOK.border}`,
          }}
        >
          <div className="flex items-center gap-2">
            <Calendar size={14} style={{ color: TOK.textSecondary }} />
            <span
              className="text-xs uppercase tracking-[0.18em] font-medium"
              style={{ color: TOK.textSecondary }}
            >
              What&apos;s coming
            </span>
          </div>
          <ul className="flex flex-col gap-3.5">
            {COMING.map((item) => (
              <li key={item.title} className="flex items-start gap-3">
                <span
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 mt-0.5 text-center min-w-[4.5rem] box-border"
                  style={{
                    background: TOK.surface,
                    color: TOK.textMuted,
                    border: `1px solid ${TOK.border}`,
                  }}
                >
                  {item.tag}
                </span>
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span
                    className="text-sm font-medium"
                    style={{ color: TOK.textPrimary }}
                  >
                    {item.title}
                  </span>
                  <span
                    className="text-xs leading-relaxed"
                    style={{ color: TOK.textSecondary }}
                  >
                    {item.description}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
