// Inline PR-bot callout that lives at the bottom of the PRs tab
// (app/session/[id]/prs/page.tsx). Designed as a natural extension
// of the historical PR-flow analysis above it:
//
//   "You're looking at how your PRs have flowed historically.
//    Here's how to get the same signal-layer applied to every
//    new PR automatically."
//
// Medium-depth content per the design discussion: short explainer,
// styled sample comment, three-step "how it works", install CTA,
// privacy + limits one-liner. Anything deeper (FAQ, troubleshooting,
// configuration) belongs on the README or a future dedicated page.

import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  GitPullRequest,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { TOK } from "@/lib/sessionTheme";
import type { Tier } from "@/components/TierIcon";

const INSTALL_URL = "https://github.com/apps/codetrawl-pr";
const LEARN_MORE_URL =
  "https://github.com/coffeejones/gitvision#pr-bot-github-app";

interface Props {
  /** Subscription tier of the viewing user. Free sees an upgrade
   *  prompt instead of the Install CTA — bot install is a Plus+
   *  feature. */
  userTier: Tier;
}

export function PRBotCallout({ userTier }: Props) {
  const canInstall = userTier !== "open-case";
  return (
    <section
      className="flex flex-col gap-5 pt-8 mt-2"
      style={{ borderTop: `1px solid ${TOK.border}` }}
    >
      {/* Header — eyebrow + h2 + intro paragraph */}
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <GitPullRequest size={14} style={{ color: TOK.accent }} />
          <span
            className="text-xs uppercase tracking-[0.18em] font-medium"
            style={{ color: TOK.textMuted }}
          >
            CodeTrawl PR-bot · GitHub App · private beta
          </span>
        </div>
        <h2
          className="text-2xl sm:text-3xl font-semibold tracking-tight"
          style={{ letterSpacing: "-0.02em" }}
        >
          Want this analysis on every PR?
        </h2>
        <p
          className="text-sm sm:text-base max-w-3xl leading-relaxed"
          style={{ color: TOK.textSecondary }}
        >
          CodeTrawl-PR is a GitHub App that runs the same signal layer
          as the analysis above — but on every new pull request,
          automatically. One grounded review comment per PR. No LLM
          in the comment, no token cost, no surprise bills.
        </p>
      </header>

      {/* Body — 2-column on lg: sample comment + how-it-works/CTA */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Sample comment — styled to look like a code-block / Slack
         *  pre. Severity dots use the same color tokens the actual
         *  bot uses (rose / amber / accent). */}
        <div
          className="rounded-lg p-4 text-xs font-mono leading-relaxed flex flex-col gap-1"
          style={{
            background: TOK.bgDeep,
            border: `1px solid ${TOK.border}`,
            color: TOK.textSecondary,
          }}
        >
          <div
            className="text-[10px] uppercase tracking-[0.18em] mb-1.5"
            style={{ color: TOK.textMuted }}
          >
            Sample comment on a PR
          </div>
          <div style={{ color: TOK.textPrimary }}>
            <strong>CodeTrawl Review</strong>
          </div>
          <div>
            Diff summary: 3 files changed · functions: 5 added, 2
            removed · net complexity +4
          </div>
          <div className="mt-1.5" style={{ color: TOK.textMuted }}>
            Suggested verification (top 3):
          </div>
          <div className="mt-0.5">
            <span style={{ color: TOK.rose }}>● CRITICAL</span> —
            load_dotenv grew +4 complexity (9→13). No tests changed.
          </div>
          <div>
            <span style={{ color: TOK.amber }}>● WARNING</span> —
            _path_is_relative_to was removed. Verify no callers depend
            on it.
          </div>
          <div>
            <span style={{ color: TOK.accent }}>● INFO</span> —
            Sizeable PR — 23 files, 109 changes.
          </div>
        </div>

        {/* How it works + CTAs */}
        <div
          className="rounded-lg p-5 flex flex-col gap-4"
          style={{
            background: TOK.surface,
            border: `1px solid ${TOK.border}`,
          }}
        >
          <div className="flex flex-col gap-3">
            <span
              className="text-[10px] uppercase tracking-[0.18em] font-medium"
              style={{ color: TOK.textMuted }}
            >
              How it works
            </span>
            <ol className="flex flex-col gap-2.5 text-sm leading-relaxed">
              {[
                "Install the GitHub App on a public repo.",
                "On every pull_request.opened / synchronize / reopened, the bot analyzes the base + head SHAs.",
                "Posts (or updates) one comment with up to 3 prioritized verification suggestions — find-or-update, never duplicates.",
              ].map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span
                    className="font-mono text-xs shrink-0 mt-0.5"
                    style={{ color: TOK.accent }}
                  >
                    {i + 1}
                  </span>
                  <span style={{ color: TOK.textSecondary }}>{step}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* CTA row — primary install for Plus+ / upgrade-prompt
           *  for Free. Secondary learn-more link is the same for both. */}
          <div className="flex items-center gap-3 flex-wrap pt-1">
            {canInstall ? (
              <a
                href={INSTALL_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition"
                style={{
                  background: TOK.accent,
                  color: TOK.accentOn,
                }}
              >
                Install CodeTrawl-PR
                <ArrowUpRight size={14} />
              </a>
            ) : (
              <Link
                href="/pricing"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition hover:opacity-90"
                style={{
                  background: TOK.textPrimary,
                  color: TOK.bg,
                }}
              >
                <Lock size={13} />
                Upgrade to install
                <ArrowRight size={13} />
              </Link>
            )}
            <a
              href={LEARN_MORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm transition hover:underline"
              style={{ color: TOK.textSecondary }}
            >
              Learn more
              <ArrowUpRight size={12} />
            </a>
          </div>
        </div>
      </div>

      {/* Footer line — privacy + limits in one breath */}
      <div
        className="flex items-center gap-2 text-xs flex-wrap"
        style={{ color: TOK.textMuted }}
      >
        <ShieldCheck size={12} style={{ color: TOK.textMuted }} />
        <span>Public repos only</span>
        <span style={{ color: TOK.border }}>·</span>
        <span>zero LLM cost</span>
        <span style={{ color: TOK.border }}>·</span>
        <span>uninstall removes all bot-created sessions</span>
        <span style={{ color: TOK.border }}>·</span>
        <span>repos under 100 MB</span>
      </div>
    </section>
  );
}
