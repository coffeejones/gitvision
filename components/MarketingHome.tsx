// Marketing-style landing layout (v0.69 / C3 polish).
//
// What the home page used to be: hero + URL input form + demo chips
// + saved-sessions card + "What you'll find" feature grid + footer.
// Designed for first-time visitors who arrive cold from HN/Reddit
// and need the marketing pitch before they understand what GitVision
// does.
//
// Rendered by AdaptiveHome when the visitor has no owned sessions
// in localStorage. Returning power-users see WorkspaceHome instead.

import Link from "next/link";
import { STYLE, TOK } from "@/lib/theme";
import { type DemoRepo } from "@/components/RepoInputForm";
import { LandingPanel } from "@/components/LandingPanel";
import { FeedbackLink } from "@/components/FeedbackLink";
import { Logo } from "@/components/Logo";
import type { SessionSummary } from "@/lib/types";

interface Props {
  demoRepos: DemoRepo[];
  demoSessions: Record<string, string>;
  initialSessions: SessionSummary[];
}

export function MarketingHome({
  demoRepos,
  demoSessions,
  initialSessions,
}: Props) {
  return (
    <main className="max-w-5xl w-full mx-auto px-8 pt-16 pb-20 flex flex-col gap-16">
      {/* Hero — text only. Form + Try-a-demo + Your-sessions live in
       *  LandingPanel below so the URL field, demo picker, and saved
       *  sessions share one client component (lifted value state). */}
      <section className="flex flex-col gap-7">
        {/* Brand mark — small, pre-hero anchor. Matches the topbar
         *  treatment so users have a consistent "where am I" cue
         *  across the marketing → session transition. */}
        <Logo size={22} wordmark />
        <div className="flex items-center gap-2">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: TOK.accent }}
          />
          <span
            className="text-xs uppercase tracking-[0.18em] font-medium"
            style={{ color: TOK.textSecondary }}
          >
            Alpha · code analysis across 7 languages
          </span>
        </div>

        <h1
          className="text-5xl sm:text-6xl font-semibold tracking-tight leading-[1.05]"
          style={{ letterSpacing: "-0.03em" }}
        >
          Map any GitHub repo.{" "}
          <span style={{ color: TOK.accent }}>
            See blast radius, structural duplicates, and untested code.
          </span>
        </h1>

        <p
          className="text-lg max-w-2xl leading-relaxed"
          style={{ color: TOK.textSecondary }}
        >
          Paste a URL. Click any file or function — see exactly what
          breaks if you change it. AST-based analysis across 7 languages,
          in under 20 seconds. Every insight links to its source.
        </p>

        <LandingPanel
          demoRepos={demoRepos}
          demoSessions={demoSessions}
          initialSessions={initialSessions}
        />
      </section>

      {/* What you'll find — feature-specific cards highlighting the
       *  three concrete signals users get on a session page. */}
      <section className="flex flex-col gap-6">
        <div className="flex items-baseline justify-between">
          <h2 className={STYLE.sectionTitle}>What you&apos;ll find</h2>
          <div className="text-xs" style={{ color: TOK.textMuted }}>
            things GitHub Insights doesn&apos;t show
          </div>
        </div>

        <div
          className="grid grid-cols-1 md:grid-cols-3 gap-px overflow-hidden rounded-xl"
          style={{ background: TOK.border }}
        >
          {[
            {
              t: "Blast radius",
              d: "Click any file or function. See what breaks if you change it — three hops deep across the call graph.",
            },
            {
              t: "Near-duplicates",
              d: "Structural AST hashing finds 36 copies of one ARM rewrite pattern in golang/go src/cmd. Across 7 languages.",
            },
            {
              t: "Untested hotspots",
              d: "Most-complex production functions with zero test caller. Computed by walking the call graph from test files into production code.",
            },
          ].map((s) => (
            <div
              key={s.t}
              className="p-6 flex flex-col gap-2"
              style={{ background: TOK.bg }}
            >
              <h3
                className="text-base font-semibold"
                style={{ color: TOK.textPrimary }}
              >
                {s.t}
              </h3>
              <p
                className="text-sm leading-relaxed"
                style={{ color: TOK.textSecondary }}
              >
                {s.d}
              </p>
            </div>
          ))}
        </div>

        <div className="text-xs" style={{ color: TOK.textMuted }}>
          Tree-sitter AST across JS/TS, Python, Go, Java, C#, PHP, Ruby.
          Kotlin via regex fallback (imports only). Big monorepos? Paste
          a deep-link to a subdirectory to scope the analysis.
        </div>
      </section>

      {/* Footer. */}
      <footer
        className="pt-8 text-xs flex items-center justify-between border-t flex-wrap gap-3"
        style={{ borderColor: TOK.border, color: TOK.textMuted }}
      >
        <span>GitVision · made by coffeejones</span>
        <div className="flex items-center gap-3 flex-wrap">
          <a
            href="https://github.com/coffeejones/gitvision"
            target="_blank"
            rel="noopener"
            className="transition hover:underline"
          >
            GitHub
          </a>
          {/* Discord — only renders when invite URL is configured.
           *  Graceful: deploy ships the wiring, set
           *  NEXT_PUBLIC_DISCORD_INVITE_URL when the community server
           *  is ready. Until then this row stays clean instead of
           *  shipping a broken / placeholder link. */}
          {process.env.NEXT_PUBLIC_DISCORD_INVITE_URL && (
            <>
              <span style={{ color: TOK.border }}>·</span>
              <a
                href={process.env.NEXT_PUBLIC_DISCORD_INVITE_URL}
                target="_blank"
                rel="noopener"
                className="transition hover:underline"
              >
                Discord
              </a>
            </>
          )}
          <span style={{ color: TOK.border }}>·</span>
          <FeedbackLink className="transition hover:underline cursor-pointer">
            Feedback
          </FeedbackLink>
          <span style={{ color: TOK.border }}>·</span>
          <Link href="/legal" className="transition hover:underline">
            Privacy &amp; terms
          </Link>
          <span style={{ color: TOK.border }}>·</span>
          <span>PolyForm Noncommercial</span>
        </div>
      </footer>
    </main>
  );
}
