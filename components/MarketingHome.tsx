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
    <div
      className="min-h-screen w-full"
      style={{
        // Ambient depth — diagonal monochrome gradient across the
        // whole viewport. Linear (not radial) so the highlight reads
        // as "ambient light from the top-right direction" rather
        // than "a circle of light glowing on the wall". The dark
        // diagonal counter-gradient adds weight without a visible
        // shape. Dot grid stays for texture.
        backgroundColor: TOK.bg,
        backgroundImage: `
          linear-gradient(225deg, rgba(255,255,255,0.08) 0%, transparent 55%),
          linear-gradient(45deg, rgba(0,0,0,0.35) 0%, transparent 55%),
          radial-gradient(circle at 50% 50%, rgba(255,255,255,0.035) 1px, transparent 1px)
        `,
        backgroundSize: "auto, auto, 28px 28px",
        backgroundPosition: "0 0, 0 0, 0 0",
        backgroundAttachment: "fixed, fixed, fixed",
      }}
    >
      <main className="max-w-6xl w-full mx-auto px-6 sm:px-10 lg:px-16 pt-20 pb-24 flex flex-col gap-20">
        {/* Hero — text only. Form + Try-a-demo + Your-sessions live in
         *  LandingPanel below so the URL field, demo picker, and saved
         *  sessions share one client component (lifted value state). */}
        <section className="flex flex-col gap-8">
          {/* Brand mark — bigger here than the topbar treatment because
           *  this is the visitor's first anchor. */}
          <Logo size={28} wordmark />

          <h1
            className="text-5xl sm:text-6xl lg:text-7xl font-semibold tracking-tight leading-[1.02]"
            style={{ letterSpacing: "-0.035em" }}
          >
            Know your code{" "}
            <span
              // Subtle 3-stop gradient — lighter emerald at top-left,
              // through standard accent in the middle, to deeper green
              // bottom-right. Reads as one color from a distance; the
              // gradient surfaces only on closer look. Matches the
              // "metallic emerald" treatment Linear / Vercel use.
              style={{
                backgroundImage:
                  "linear-gradient(135deg, #34d399 0%, #10b981 50%, #047857 100%)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                WebkitTextFillColor: "transparent",
                color: "transparent",
              }}
            >
              before you touch it.
            </span>
          </h1>

          <p
            className="text-lg sm:text-xl max-w-2xl leading-relaxed"
            style={{ color: TOK.textSecondary }}
          >
            GitVision maps any GitHub repo in 20 seconds. Spot blast radius,
            untested hotspots, structural duplicates, and architecture
            risks — across 7 languages. Plus a GitHub App that surfaces
            the same signals as a single review comment on every PR.
          </p>

          <LandingPanel
            demoRepos={demoRepos}
            demoSessions={demoSessions}
            initialSessions={initialSessions}
          />
        </section>

      {/* What you'll find — feature-specific cards highlighting the
       *  concrete signals users get on a session page + the PR-bot. */}
      <section className="flex flex-col gap-6">
        <div className="flex items-baseline justify-between">
          <h2 className={STYLE.sectionTitle}>What you&apos;ll find</h2>
          <div className="text-xs" style={{ color: TOK.textMuted }}>
            things GitHub Insights doesn&apos;t show
          </div>
        </div>

        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px overflow-hidden rounded-xl"
          style={{ background: TOK.border }}
        >
          {[
            {
              t: "Blast radius",
              d: "Click any file or function. See what breaks if you change it — three hops deep across the call graph.",
            },
            {
              t: "Repo health",
              d: "Red / yellow / green verdict grounded in 17 deterministic signals — complexity, churn, coverage, dependencies. No AI hallucination.",
            },
            {
              t: "Architecture canvas",
              d: "Folder frames + file cards laid out as a packed map. Time-scrub to watch the codebase evolve commit-by-commit.",
            },
            {
              t: "Untested hotspots",
              d: "Most-complex production functions with zero test caller. Computed by walking the call graph from test files into production code.",
            },
            {
              t: "Near-duplicates",
              d: "Structural AST hashing finds 36 copies of one ARM rewrite pattern in golang/go src/cmd. Across 7 languages.",
            },
            {
              t: "PR-bot · new",
              d: "Install the GitHub App. Every PR gets one grounded review comment from the same signal layer. Zero LLM cost, deterministic-only.",
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

      {/* Real findings — concrete proof that the analysis catches
       *  things on famous open source repos. Builds trust through
       *  evidence instead of claims. */}
      <section className="flex flex-col gap-6">
        <div className="flex items-baseline justify-between">
          <h2 className={STYLE.sectionTitle}>Real findings</h2>
          <div className="text-xs" style={{ color: TOK.textMuted }}>
            actual signals from our analysis of famous repos
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {[
            {
              repo: "golang/go",
              finding:
                "Near-duplicates found 36 copies of one ARM register-shift rewrite pattern across src/cmd/compile — canonical SSA-rewrite family",
              signal: "Near-duplicates",
            },
            {
              repo: "django/django",
              finding:
                "_alter_field has cyclomatic complexity 91 — the schema migration's most complex single method. Two test callers, zero direct tests.",
              signal: "Untested hotspots",
            },
            {
              repo: "pallets/flask",
              finding:
                "load_dotenv grew +4 cyclomatic complexity between 3.0.3 and 3.1.0 — no tests changed in the same module. Caught at PR time by our rules engine.",
              signal: "PR-bot · complexity delta",
            },
            {
              repo: "spring-projects/spring-petclinic",
              finding:
                "Type-aware call resolution resolved 8 ambiguous validate() call-sites to the right overload. Unresolved list is now exclusively stdlib + Spring.",
              signal: "Call graph",
            },
          ].map((f) => (
            <div
              key={f.repo}
              className="p-4 rounded-lg flex items-start gap-4"
              style={{
                background: TOK.surface,
                border: `1px solid ${TOK.border}`,
              }}
            >
              <div className="flex flex-col gap-1 shrink-0 min-w-[12rem]">
                <span
                  className="text-xs font-mono"
                  style={{ color: TOK.textPrimary }}
                >
                  {f.repo}
                </span>
                <span
                  className="text-xs"
                  style={{ color: TOK.accent }}
                >
                  {f.signal}
                </span>
              </div>
              <p
                className="text-sm leading-relaxed flex-1"
                style={{ color: TOK.textSecondary }}
              >
                {f.finding}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Two surfaces — explicit workspace-vs-bot positioning so new
       *  visitors understand that the PR-bot is a feature of the
       *  broader codebase-intelligence platform, not the product
       *  itself. Includes a sample PR comment for tangibility. */}
      <section className="flex flex-col gap-6">
        <div className="flex items-baseline justify-between">
          <h2 className={STYLE.sectionTitle}>Two surfaces, one signal layer</h2>
          <div className="text-xs" style={{ color: TOK.textMuted }}>
            same deterministic pipeline, two ways to consume it
          </div>
        </div>

        <div
          className="grid grid-cols-1 md:grid-cols-2 gap-px overflow-hidden rounded-xl"
          style={{ background: TOK.border }}
        >
          {/* Workspace */}
          <div
            className="p-6 flex flex-col gap-3"
            style={{ background: TOK.bg }}
          >
            <span
              className="text-xs uppercase tracking-[0.18em] font-medium"
              style={{ color: TOK.accent }}
            >
              Workspace · gitvision.net
            </span>
            <h3
              className="text-xl font-semibold"
              style={{ color: TOK.textPrimary }}
            >
              Map an entire repo
            </h3>
            <p
              className="text-sm leading-relaxed"
              style={{ color: TOK.textSecondary }}
            >
              Paste a URL. Get an explorable canvas, blast radius,
              untested hotspots, near-duplicates, dependency health,
              and a red / yellow / green verdict grounded in 17
              deterministic signals — all under one workspace.
            </p>
            <p
              className="text-xs"
              style={{ color: TOK.textMuted }}
            >
              Free to try · public repos · sessions saved as JSON ·
              works on monorepo subdirectories
            </p>
          </div>

          {/* PR-bot */}
          <div
            className="p-6 flex flex-col gap-3"
            style={{ background: TOK.bg }}
          >
            <span
              className="text-xs uppercase tracking-[0.18em] font-medium"
              style={{ color: TOK.accent }}
            >
              PR-bot · GitHub App
            </span>
            <h3
              className="text-xl font-semibold"
              style={{ color: TOK.textPrimary }}
            >
              Review every PR
            </h3>
            <p
              className="text-sm leading-relaxed"
              style={{ color: TOK.textSecondary }}
            >
              Install the app on a public repo. On every PR, get one
              grounded review comment with the top verification signals
              from the diff — links back to the workspace for the
              deep dive.
            </p>
            <div
              className="text-xs font-mono p-3 rounded leading-relaxed mt-1"
              style={{
                background: TOK.bgDeep,
                color: TOK.textSecondary,
                border: `1px solid ${TOK.border}`,
              }}
            >
              <div style={{ color: TOK.textPrimary }}>
                <strong>GitVision Review</strong>
              </div>
              <div className="mt-1">
                Diff summary: 3 files changed · functions: 5 added, 2
                removed · net complexity +4
              </div>
              <div className="mt-2">Suggested verification (top 3):</div>
              <div className="mt-1">
                <span style={{ color: TOK.rose }}>● CRITICAL</span> —
                load_dotenv grew +4 complexity (9→13). No tests changed.
              </div>
              <div>
                <span style={{ color: TOK.amber }}>● WARNING</span> —
                _path_is_relative_to was removed. Verify no callers
                depend on it.
              </div>
              <div>
                <span style={{ color: TOK.accent }}>● INFO</span> —
                Sizeable PR — 23 files, 109 changes.
              </div>
            </div>
            <p
              className="text-xs"
              style={{ color: TOK.textMuted }}
            >
              Private beta · zero LLM cost · find-or-update on every
              synchronize
            </p>
          </div>
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
    </div>
  );
}
