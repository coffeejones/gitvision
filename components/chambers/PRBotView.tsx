// PR-bot view — the in-workspace PR-bot surface (renders inside the Chambers
// shell, so the sidebar stays put). CH-themed twin of the marketing
// PRBotCallout: what it is, a sample comment, the three-step flow, and a
// tier-aware install / upgrade CTA. Content-only — the shell is the layout.

import Link from "next/link";
import { ArrowUpRight, ArrowRight, GitPullRequest, Lock, ShieldCheck } from "lucide-react";
import { CH, CH_FOCUS } from "./theme";

const INSTALL_URL = "https://github.com/apps/codetrawl-pr";
const LEARN_MORE_URL = "https://github.com/coffeejones/gitvision#pr-bot-github-app";

export function PRBotView({ canInstall }: { canInstall: boolean }) {
  return (
    <div>
      <header className="mb-7">
        <h1
          className="text-[28px] font-semibold tracking-tight"
          style={{ color: CH.text, letterSpacing: "-0.025em" }}
        >
          PR-bot
        </h1>
        <p className="mt-1.5 text-[14px]" style={{ color: CH.textDim }}>
          The same grade, on every pull request — one grounded review comment,
          no LLM in the loop, no token cost.
        </p>
      </header>

      <div className="flex flex-col gap-4">
        {/* Sample comment — a styled "what you'll get" block. */}
        <section
          className="rounded-xl p-5"
          style={{ background: CH.panel, border: `1px solid ${CH.border}` }}
        >
          <div
            className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: CH.textMuted }}
          >
            <GitPullRequest size={12} style={{ color: CH.accent }} />
            Sample comment on a PR
          </div>
          <div
            className="rounded-lg p-4 font-mono text-[12px] leading-relaxed flex flex-col gap-1"
            style={{ background: CH.bg, border: `1px solid ${CH.border}`, color: CH.textDim }}
          >
            <div style={{ color: CH.text }}>
              <strong>CodeTrawl Review</strong>
            </div>
            <div>Diff: 3 files · functions +5 / −2 · net complexity +4</div>
            <div className="mt-1.5" style={{ color: CH.textMuted }}>
              Suggested verification (top 3):
            </div>
            <div>
              <span style={{ color: CH.critical }}>● CRITICAL</span> — load_dotenv grew +4 complexity (9→13). No tests changed.
            </div>
            <div>
              <span style={{ color: CH.warning }}>● WARNING</span> — _path_is_relative_to removed. Verify no callers depend on it.
            </div>
            <div>
              <span style={{ color: CH.accent }}>● INFO</span> — Sizeable PR — 23 files, 109 changes.
            </div>
          </div>
        </section>

        {/* How it works + CTA. */}
        <section
          className="rounded-xl p-5 flex flex-col gap-4"
          style={{ background: CH.panel, border: `1px solid ${CH.border}` }}
        >
          <div
            className="text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: CH.textMuted }}
          >
            How it works
          </div>
          <ol className="flex flex-col gap-2.5 text-[14px] leading-relaxed">
            {[
              "Install the GitHub App on a public repo.",
              "On every pull_request opened / synchronized / reopened, the bot analyzes the base + head SHAs.",
              "It posts (or updates) one comment with up to 3 prioritized verification suggestions — find-or-update, never duplicates.",
            ].map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="font-mono text-[12px] shrink-0 mt-0.5" style={{ color: CH.accent }}>
                  {i + 1}
                </span>
                <span style={{ color: CH.textDim }}>{step}</span>
              </li>
            ))}
          </ol>

          <div className="flex items-center gap-3 flex-wrap pt-1">
            {canInstall ? (
              <a
                href={INSTALL_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold transition-all hover:-translate-y-px ${CH_FOCUS}`}
                style={{ background: CH.accent, color: CH.accentText }}
              >
                Install CodeTrawl-PR
                <ArrowUpRight size={14} />
              </a>
            ) : (
              <Link
                href="/pricing"
                className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold transition-all hover:-translate-y-px ${CH_FOCUS}`}
                style={{ background: CH.text, color: CH.bg }}
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
              className={`inline-flex items-center gap-1.5 rounded text-[13px] transition hover:underline ${CH_FOCUS}`}
              style={{ color: CH.textDim }}
            >
              Learn more
              <ArrowUpRight size={12} />
            </a>
          </div>
        </section>

        {/* Privacy + limits — one calm line. */}
        <div
          className="flex flex-wrap items-center gap-2 text-[11.5px]"
          style={{ color: CH.textMuted }}
        >
          <ShieldCheck size={12} />
          <span>Public repos only</span>
          <span>·</span>
          <span>zero LLM cost</span>
          <span>·</span>
          <span>uninstall removes all bot-created sessions</span>
          <span>·</span>
          <span>repos under 100 MB</span>
        </div>
      </div>
    </div>
  );
}
