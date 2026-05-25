// Marketing-style landing layout (v0.69 / C3 polish + v0.76 login-
// required model).
//
// Two flavours behind the same component:
//
//   • Logged-OUT visitor → demo cards as the hero. Anonymous session
//     creation was removed in v0.76, so there's no point putting a
//     URL input where it can't lead anywhere. Instead, four pre-
//     built analyses act as the "see it in action" lead-in, with a
//     prominent Sign up CTA below.
//
//   • Logged-IN visitor (but no owned sessions yet) → the original
//     LandingPanel — URL form + demo chips + "Your sessions" row.
//     This is the just-signed-up path; they need the form right
//     where they can use it.
//
// Both flavours share the rest of the page (feature grid, real
// findings, two surfaces, roadmap, footer). Only the hero swaps.
//
// The `loggedIn` flag is passed in as a prop from AdaptiveHome (which
// itself receives it from the server-rendered page.tsx). We can't read
// the auth session directly here via next/headers because this file
// gets pulled into the client bundle via AdaptiveHome — same constraint
// as MarketingNav. The prop threading is the price for being able to
// live on both sides of the boundary.

import Link from "next/link";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Copy,
  Network,
  ShieldOff,
  Star,
  Target,
} from "lucide-react";
import { STYLE, TOK } from "@/lib/theme";
import { type DemoRepo } from "@/components/RepoInputForm";
import { LandingPanel } from "@/components/LandingPanel";
import { FeedbackLink } from "@/components/FeedbackLink";
import { MarketingNav } from "@/components/MarketingNav";
import { Logo } from "@/components/Logo";
import { Roadmap } from "@/components/Roadmap";
import type { DemoCard } from "@/lib/intelligence/demoCard";
import { ScrollReveal } from "@/components/ScrollReveal";

interface Props {
  demoRepos: DemoRepo[];
  demoSessions: Record<string, string>;
  /** Rich demo cards (summary + scale stats) per pre-built demo
   *  session, keyed by repoFullName. Replaces the v0.76 demoSummaries
   *  prop with a richer payload so cards can show stars, file count,
   *  function count, hotspots in addition to the headline finding. */
  demoCards: Record<string, DemoCard>;
  /** Server-decided auth state. Drives the hero variant — demos for
   *  logged-out callers, LandingPanel for logged-in. AdaptiveHome
   *  receives this from page.tsx (which reads Better Auth server-
   *  side) and forwards it here. */
  loggedIn: boolean;
}

export function MarketingHome({
  demoRepos,
  demoSessions,
  demoCards,
  loggedIn,
}: Props) {
  return (
    <div
      className="min-h-screen w-full"
      style={{
        // Ambient depth — two diagonal monochrome gradients across
        // the viewport. Top-right highlight + bottom-left shadow read
        // as "light from upper-right" without locking into a circle.
        //
        // The 28px dot-grid we had here originally was a "Next.js
        // landing template" signal — once you've seen it on enough
        // open-source landings the eye reads it as "shipped a tutorial",
        // not "built a product". Dropped in v0.76 polish in favour of
        // gradients alone, which is the Linear / Stripe pattern.
        backgroundColor: TOK.bg,
        backgroundImage: `
          linear-gradient(225deg, rgba(255,255,255,0.08) 0%, transparent 55%),
          linear-gradient(45deg, rgba(0,0,0,0.35) 0%, transparent 55%)
        `,
        backgroundAttachment: "fixed, fixed",
      }}
    >
      <MarketingNav />
      <main className="max-w-7xl w-full mx-auto px-6 sm:px-10 lg:px-12 pt-10 pb-16 flex flex-col gap-14">
        {/* Hero — sprint-1 copy-anchored wedge with the original
         *  FeaturedHero composition restored (v0.80 reset). After
         *  trying live-graph and integrated-bg experiments, the
         *  founder's clear preference remained the two-image layered
         *  FeaturedHero (workspace forground + Code-tab dimmed
         *  background) that ships on main. Keep what works; refine
         *  the rest of the page.
         *
         *  The wedge stays: "deterministic / no LLM" is the only word
         *  LLM-core competitors (CodeRabbit, Greptile, Cody, Cursor)
         *  structurally cannot follow without invalidating their own
         *  product narrative. The `git blame` reference signals "we
         *  know what auditing actually means" to a senior dev in
         *  three words. */}
        <section className="flex flex-col gap-5">
          <span
            className="text-[10px] uppercase tracking-[0.18em] font-medium"
            style={{ color: TOK.accent }}
          >
            Deterministic · No LLM
          </span>
          <h1
            className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight"
            style={{
              color: TOK.textPrimary,
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
            }}
          >
            The codebase tool that doesn&apos;t guess.
          </h1>

          <p
            className="text-base sm:text-lg max-w-2xl leading-relaxed"
            style={{ color: TOK.textSecondary }}
          >
            Every finding is a deterministic AST signal you can verify
            in{" "}
            <code
              style={{
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: "0.92em",
                padding: "1px 5px",
                background: "rgba(255,255,255,0.06)",
                border: `1px solid ${TOK.border}`,
                borderRadius: 4,
                color: TOK.textPrimary,
              }}
            >
              git blame
            </code>
            . No prompts, no hallucinations, no LLM bill — just 20
            grounded signals across 7 languages.
          </p>

          {loggedIn ? (
            // Logged-in path: interactive onboarding panel — URL form
            // for analyzing a new repo + demo chips. "Your sessions"
            // card was removed in v0.76 polish; this panel only
            // renders for logged-in users with 0 sessions, so an
            // always-empty card was hobby-chrome.
            <LandingPanel
              demoRepos={demoRepos}
              demoSessions={demoSessions}
            />
          ) : (
            // Logged-out path: demo cards as the hero lead-in.
            // Anonymous session creation was removed in v0.76 — the
            // form would have nowhere to send you, so we replace it
            // with the most compelling thing we have (real prebuilt
            // analyses of famous repos) and a Sign-up CTA.
            <LoggedOutHero
              demoRepos={demoRepos}
              demoSessions={demoSessions}
              demoCards={demoCards}
            />
          )}
        </section>

      {/* Findings from real repos — concrete proof, promoted to lead
       *  section (v0.79 polish). The page's most defensible content is
       *  the four falsifiable, numerical findings on famous repos —
       *  burying them under a generic feature-grid was backwards rhythm
       *  ("category → benefits → proof" instead of "proof → category").
       *  Swapped order: findings now hit the eye SECOND (after hero),
       *  feature catalog demoted to third. Eyebrow lists the repos
       *  directly so a dev recognises the proof set before reading any
       *  body copy. */}
      <ScrollReveal>
      <section className="flex flex-col gap-5">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h2 className={STYLE.sectionTitle}>Findings from real repos</h2>
          <div
            className="text-xs font-mono"
            style={{ color: TOK.textMuted }}
          >
            golang/go · django/django · pallets/flask · spring-petclinic
          </div>
        </div>

        {/* 2-col grid of finding cards. Drops the prior tabular layout
         *  (fixed-width left column + stacked rows) which read as
         *  "spreadsheet of evidence". New layout: repo + signal as
         *  inline meta header, finding text below as the body. Same
         *  card recipe as the feature grid below so the page reads as
         *  one design system. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {[
            {
              repo: "golang/go",
              finding:
                "Near-duplicates found 36 copies of one ARM register-shift rewrite pattern across src/cmd/compile — canonical SSA-rewrite family.",
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
              className="flex flex-col gap-3 p-5 rounded-xl transition-all duration-200 hover:-translate-y-0.5"
              style={{
                background: TOK.bg,
                border: `1px solid ${TOK.border}`,
              }}
            >
              <div className="flex items-center gap-2 text-xs">
                <span
                  className="font-mono"
                  style={{ color: TOK.textPrimary }}
                >
                  {f.repo}
                </span>
                <span style={{ color: TOK.textMuted }}>·</span>
                <span style={{ color: TOK.accent }}>{f.signal}</span>
              </div>
              <p
                className="text-sm leading-relaxed"
                style={{ color: TOK.textSecondary }}
              >
                {f.finding}
              </p>
            </div>
          ))}
        </div>
      </section>
      </ScrollReveal>

      {/* What you'll find — feature catalog. ScrollReveal triggers a
       *  12px slide + fade when the section enters the viewport. Once
       *  revealed, the observer disconnects so it doesn't re-animate
       *  on scroll-back. */}
      <ScrollReveal>
      <section className="flex flex-col gap-5">
        <div className="flex items-baseline justify-between">
          <h2 className={STYLE.sectionTitle}>What you&apos;ll find</h2>
          <div className="text-xs" style={{ color: TOK.textMuted }}>
            things GitHub Insights doesn&apos;t show
          </div>
        </div>

        {/* Feature grid — icon-led cards. Drops the prior `gap-px`
         *  table-cell look (which read as "spreadsheet of features")
         *  in favour of standalone cards with a small icon chip, room
         *  to breathe, and a hover-lift. Same shadow / border recipe
         *  as the rest of the page so it reads as one design system. */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            {
              t: "Blast radius",
              d: "Click any file or function. See what breaks if you change it — three hops deep across the call graph.",
              icon: Target,
            },
            {
              t: "Repo health",
              d: "Red / yellow / green verdict grounded in 20 deterministic signals — complexity, churn, coverage, dependencies. No AI hallucination.",
              icon: Activity,
            },
            {
              t: "Architecture canvas",
              d: "Folder frames + file cards laid out as a packed map. Time-scrub to watch the codebase evolve commit-by-commit.",
              icon: Network,
            },
            {
              t: "Untested hotspots",
              d: "Most-complex production functions with zero test caller. Computed by walking the call graph from test files into production code.",
              icon: ShieldOff,
            },
            {
              t: "Near-duplicates",
              d: "Structural AST hashing finds 36 copies of one ARM rewrite pattern in golang/go src/cmd. Across 7 languages.",
              icon: Copy,
            },
            {
              t: "PR-bot · new",
              d: "Install the GitHub App. Every PR gets one grounded review comment from the same signal layer. Zero LLM cost, deterministic-only.",
              icon: Bot,
            },
          ].map((s) => {
            const Icon = s.icon;
            return (
              <div
                key={s.t}
                className="flex flex-col gap-3 p-6 rounded-xl transition-all duration-200 hover:-translate-y-0.5"
                style={{
                  background: TOK.bg,
                  border: `1px solid ${TOK.border}`,
                }}
              >
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{
                    background: "rgba(255, 255, 255, 0.04)",
                    border: `1px solid rgba(255, 255, 255, 0.06)`,
                    color: TOK.textSecondary,
                  }}
                >
                  <Icon size={16} />
                </div>
                <h3
                  className="text-base font-semibold tracking-tight"
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
            );
          })}
        </div>

        <div className="text-xs" style={{ color: TOK.textMuted }}>
          Tree-sitter AST across JS/TS, Python, Go, Java, C#, PHP, Ruby.
          Kotlin via regex fallback (imports only). Big monorepos? Paste
          a deep-link to a subdirectory to scope the analysis.
        </div>
      </section>
      </ScrollReveal>

      {/* Two surfaces — side-by-side cards. Each card has a visual
       *  element specific to its surface: Workspace shows a compact
       *  "health dimensions" grid mockup, PR-bot shows a compact PR
       *  review comment mockup. Avoids the screenshot-heavy approach
       *  of the prior zigzag attempt — keeps visual density balanced. */}
      <ScrollReveal>
      <section id="pr-bot" className="flex flex-col gap-5 scroll-mt-20">
        <div className="flex items-baseline justify-between">
          <h2 className={STYLE.sectionTitle}>
            Two surfaces, one signal layer
          </h2>
          <div className="text-xs" style={{ color: TOK.textMuted }}>
            same deterministic pipeline, two ways to consume it
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SurfaceCard
            eyebrow="Workspace"
            title="One repo, all 20 signals"
            body="Paste a URL. Get an explorable canvas, blast radius, untested hotspots, near-duplicates, dependency health, and a red / yellow / green verdict grounded in 20 deterministic signals — all under one workspace."
            footer="Public repos, free. Sessions saved as JSON. Scope to a subdirectory via deep-link."
            visual={<WorkspaceDimensionsMockup />}
          />
          <SurfaceCard
            eyebrow="PR-bot · GitHub App"
            title="Review every PR"
            body="Install the GitHub App on a public repo. On every PR, get one grounded review comment with the top verification signals from the diff — linked back to the workspace for the deep dive."
            footer={
              <>
                Private beta. Updates the same comment on every{" "}
                <code
                  style={{
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: "0.92em",
                    padding: "0 4px",
                    background: "rgba(255,255,255,0.04)",
                    border: `1px solid ${TOK.border}`,
                    borderRadius: 3,
                  }}
                >
                  synchronize
                </code>{" "}
                event. No tokens spent per PR.
              </>
            }
            visual={<PRBotCompactMockup />}
          />
        </div>
      </section>
      </ScrollReveal>

      {/* Architecture-diagram feature spotlight. Uses the same
       *  image-as-asset pattern as the hero — a real Mermaid class
       *  diagram from one of our analyzed sessions, framed with the
       *  same multi-layer shadow + border treatment, paired with a
       *  short pitch on the left. Visually anchors a unique
       *  feature (auto-extracted class diagrams) on the page. */}
      <ScrollReveal>
      <section className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-8 lg:gap-12 items-center">
        <div className="flex flex-col gap-4">
          <span
            className="text-[10px] uppercase tracking-[0.18em] font-medium"
            style={{ color: TOK.accent }}
          >
            Architecture
          </span>
          <h2
            className="text-2xl sm:text-3xl font-semibold tracking-tight"
            style={{ color: TOK.textPrimary, letterSpacing: "-0.02em" }}
          >
            See your codebase as a class diagram — automatically.
          </h2>
          <p
            className="text-sm sm:text-base leading-relaxed"
            style={{ color: TOK.textSecondary }}
          >
            RepoBaron extracts classes, interfaces, and method
            relationships from your repo&apos;s AST and renders them
            as a navigable Mermaid diagram. No manual UML, no plugins,
            no setup — just paste a URL and explore.
          </p>
          <ul
            className="flex flex-col gap-2 text-sm mt-1"
            style={{ color: TOK.textSecondary }}
          >
            <li className="flex items-start gap-2">
              <span
                className="mt-1.5 w-1 h-1 rounded-full flex-shrink-0"
                style={{ background: TOK.accent }}
              />
              <span>Filter unconnected classes, search by name, scope by folder</span>
            </li>
            <li className="flex items-start gap-2">
              <span
                className="mt-1.5 w-1 h-1 rounded-full flex-shrink-0"
                style={{ background: TOK.accent }}
              />
              <span>Export Mermaid source — paste into README or mermaid.live</span>
            </li>
            <li className="flex items-start gap-2">
              <span
                className="mt-1.5 w-1 h-1 rounded-full flex-shrink-0"
                style={{ background: TOK.accent }}
              />
              <span>JavaScript &amp; TypeScript today, more languages rolling out</span>
            </li>
          </ul>
        </div>
        <div
          className="rounded-xl overflow-hidden"
          style={{
            border: `1px solid rgba(255, 255, 255, 0.06)`,
            boxShadow: [
              "0 1px 2px rgba(0, 0, 0, 0.2)",
              "0 8px 24px -4px rgba(0, 0, 0, 0.3)",
              "0 32px 64px -16px rgba(0, 0, 0, 0.45)",
            ].join(", "),
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/marketing/classdiagram.png"
            alt="Auto-generated class diagram from a RepoBaron analysis"
            className="w-full h-auto block"
          />
        </div>
      </section>
      </ScrollReveal>

      <ScrollReveal>
        <Roadmap />
      </ScrollReveal>

      {/* Footer — two-row enterprise pattern.
       *
       *  Top row: branded Logo on the left, nav-style links on the
       *  right. The Logo is the same wordmark as the nav, so the
       *  footer reads as a deliberate closing-bracket rather than
       *  "footer links bolted on".
       *
       *  Bottom row: subtle border-separated copyright + license. No
       *  dot-bullet separators between links — whitespace + the
       *  bottom-row visual break does the structuring work.
       *
       *  Earlier "RepoBaron · made by coffeejones" signature read as
       *  "hobby project by one person" — removed in v0.76 polish. */}
      <footer
        className="mt-4 pt-8 border-t flex flex-col gap-6"
        style={{ borderColor: TOK.border, color: TOK.textMuted }}
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <Link
            href="/"
            className="flex items-center transition opacity-70 hover:opacity-100"
          >
            <Logo size={28} wordmark />
          </Link>
          <nav className="flex items-center gap-5 text-xs flex-wrap">
            <a
              href="https://github.com/coffeejones/repobaron"
              target="_blank"
              rel="noopener"
              className="transition hover:underline"
            >
              GitHub
            </a>
            {process.env.NEXT_PUBLIC_DISCORD_INVITE_URL && (
              <a
                href={process.env.NEXT_PUBLIC_DISCORD_INVITE_URL}
                target="_blank"
                rel="noopener"
                className="transition hover:underline"
              >
                Discord
              </a>
            )}
            <FeedbackLink className="transition hover:underline cursor-pointer">
              Feedback
            </FeedbackLink>
            <Link href="/legal" className="transition hover:underline">
              Privacy &amp; terms
            </Link>
          </nav>
        </div>

        <div
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pt-6 text-[11px]"
          style={{ borderTop: `1px solid ${TOK.border}` }}
        >
          <span>© 2026 RepoBaron</span>
          <span>PolyForm Noncommercial 1.0.0</span>
        </div>
      </footer>
      </main>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────
// Logged-out hero: demo cards as the lead-in + Sign up CTA.
// ───────────────────────────────────────────────────────────────────

/** Static fallback taglines for each demo repo, used only when the
 *  pre-built WorkspaceSummary is missing (corrupted session, fresh
 *  install before demos are seeded). In normal operation each card
 *  shows real headline findings instead — that's what lokker. */
const DEMO_TAGLINES: Record<string, string> = {
  "colinhacks/zod": "TypeScript-first schema validation — 30k+ stars.",
  "gin-gonic/gin": "Go's most-starred HTTP framework — minimal, fast.",
  "pallets/flask": "Python micro-framework that defined an era.",
  "spring-projects/spring-petclinic":
    "Spring Boot's canonical sample app — the reference codebase.",
};

/** Severity → brand color for the headline dot. Critical reads red,
 *  warning amber, info emerald (our accent). Visually the cards with
 *  the highest-severity findings draw the eye first — exactly the
/** Format a raw count for compact display: 30200 → "30.2k", 1500 →
 *  "1.5k", 999 → "999". Trims trailing ".0" so 30000 → "30k", not
 *  "30.0k". */
function formatCount(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return k >= 10
    ? `${Math.round(k)}k`
    : `${k.toFixed(1).replace(/\.0$/, "")}k`;
}

/** Mirror of formatCount used for star counts. Right now they're the
 *  same formatter — kept separate so we can change one without the
 *  other (stars might one day get a special "k★" treatment). */
function formatStarCount(n: number): string {
  return formatCount(n);
}

/** Hardcoded "hero" demo. We promote one repo above the rest so the
 *  landing has a single point of focus — see Linear / Stripe demos
 *  that always lead with one concrete artifact rather than a grid of
 *  equal-weight tiles. zod was picked because it's TypeScript (matches
 *  our target audience), has high stars (social proof), and reliably
 *  has interesting analysis findings. Change this string to feature a
 *  different demo. */
const FEATURED_REPO = "colinhacks/zod";

interface NormalizedDemo {
  repo: string;
  lang: string;
  sessionId: string;
  card: DemoCard | null;
  tagline: string;
}

function LoggedOutHero({
  demoRepos,
  demoSessions,
  demoCards,
}: {
  demoRepos: DemoRepo[];
  demoSessions: Record<string, string>;
  demoCards: Record<string, DemoCard>;
}) {
  // Normalize the demo list — DemoRepo is union of string | {repo, lang},
  // we only want the structured ones here so cards have a language
  // badge. Filter out demos that don't yet have a pre-built session
  // (clicking them would lead nowhere for a logged-out user).
  const all: NormalizedDemo[] = demoRepos
    .map((d) => (typeof d === "string" ? { repo: d, lang: "" } : d))
    .map((d) => ({
      repo: d.repo,
      lang: d.lang,
      sessionId: demoSessions[d.repo] ?? "",
      card: demoCards[d.repo] ?? null,
      tagline: DEMO_TAGLINES[d.repo] ?? "",
    }))
    .filter((d) => !!d.sessionId);

  // v0.80 reset: restored the original featured-demo composition
  // (zod foreground + Code-tab dimmed background via FeaturedHero)
  // after two abandoned hero experiments (live-graph + integrated-
  // bg single-image). The two-image layered hero is what works —
  // it has depth, shows real product UI, and reads as "here's a
  // deep look at one finding, here are others to explore."

  const featured =
    all.find((d) => d.repo === FEATURED_REPO) ?? all[0] ?? null;
  const others = all.filter((d) => d.repo !== featured?.repo);

  return (
    <div className="flex flex-col gap-6">
      <span
        className="text-[11px] uppercase tracking-[0.14em] font-medium"
        style={{ color: TOK.textMuted }}
      >
        See what RepoBaron found
      </span>

      {/* Featured hero — Linear-style composition: focused finding
       *  card on the left, dimmed hotspots panel extending behind it
       *  to the right. Reads as "here's a deep look at one finding,
       *  and there's a list of others to explore". */}
      {featured && featured.card && (
        <ScrollReveal>
          <FeaturedHero featured={featured} />
        </ScrollReveal>
      )}

      {/* Other demos — compact grid directly under the hero, no
       *  intermediate eyebrow. Each card is a single-click redirect
       *  to its analysis session. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {others.map((d, i) => (
          <ScrollReveal key={d.repo} delay={i * 60}>
            <SmallDemoCard demo={d} />
          </ScrollReveal>
        ))}
      </div>

      {/* Sign-up CTA — clean enterprise-style box. Off-white primary
       *  button (Linear / Stripe / Vercel pattern) so the action reads
       *  as the next step without leaning on color. Subtle background
       *  + border give it presence without competing with the hero. */}
      <div
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-6 py-5 rounded-xl mt-2"
        style={{
          background: "rgba(255, 255, 255, 0.02)",
          border: "1px solid rgba(255, 255, 255, 0.06)",
        }}
      >
        <div className="flex flex-col gap-1">
          <h3
            className="text-base font-semibold tracking-tight"
            style={{ color: TOK.textPrimary, letterSpacing: "-0.01em" }}
          >
            Analyze your own repo
          </h3>
          <p className="text-sm" style={{ color: TOK.textMuted }}>
            Free to start. Sign-up takes 30 seconds.
          </p>
        </div>
        <div className="flex items-center gap-4 flex-shrink-0">
          <Link
            href="/login"
            className="text-sm font-medium hover:underline transition"
            style={{ color: TOK.textSecondary }}
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 h-10 px-5 rounded-lg text-sm font-medium transition hover:opacity-90"
            style={{
              background: TOK.textPrimary,
              color: TOK.bg,
            }}
          >
            Sign up
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}

// ─── Featured demo hero — Linear-style message-thread card + ──────────
//                          background hotspots panel for depth.

/** Featured-finding hero. Uses real product screenshots embedded as
 *  static images — same pattern Linear uses on their landing
 *  (foreground = focused screenshot of one product surface, background
 *  = wider context of another surface dimmed behind it). Coded
 *  mockups looked "coded" no matter how much we polished — the only
 *  path to enterprise visual quality is showing actual product UI.
 *
 *  Screenshots live in public/marketing/. Re-export them when the
 *  product UI changes meaningfully so the landing doesn't drift from
 *  reality. */
function FeaturedHero({ featured }: { featured: NormalizedDemo }) {
  if (!featured.card) return null;

  return (
    <div className="relative isolate">
      {/* Background depth: wider screenshot of the code/blast-radius
       *  view, dimmed and offset right so it peeks past the
       *  foreground. Hidden on small viewports — overlap pattern
       *  needs horizontal room to read as depth. */}
      <div
        className="hidden lg:block absolute inset-y-4 right-[-4%] w-[70%] z-0 pointer-events-none rounded-xl overflow-hidden"
        style={{
          opacity: 0.55,
          // Same multi-layer shadow as the foreground, just softer —
          // grounds the background image so it doesn't float
          // disconnected.
          boxShadow:
            "0 8px 24px -4px rgba(0, 0, 0, 0.3), 0 32px 64px -16px rgba(0, 0, 0, 0.45)",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/marketing/hero-zod-code.png"
          alt=""
          className="w-full h-full object-cover object-left"
        />
        {/* Subtle right-fade so the background dissolves into the
         *  page instead of cutting hard at the right edge. */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `linear-gradient(90deg, transparent 0%, transparent 60%, ${TOK.bg} 100%)`,
          }}
        />
      </div>

      {/* Foreground: zod overview screenshot. Wraps a <Link> so the
       *  whole image is clickable through to the actual session.
       *  Constrained width on desktop so the background image is
       *  visible to its right. */}
      <Link
        href={`/session/${featured.sessionId}`}
        className="group block relative z-10 lg:w-[62%] rounded-xl overflow-hidden transition-all duration-300 hover:-translate-y-1"
        style={{
          // Multi-layer shadow stack — same depth recipe as Linear /
          // Stripe / Vercel hero screenshots. Adds the "screenshot
          // floating off the page" lift.
          boxShadow: [
            "0 1px 2px rgba(0, 0, 0, 0.25)",
            "0 8px 24px -4px rgba(0, 0, 0, 0.35)",
            "0 32px 80px -16px rgba(0, 0, 0, 0.55)",
          ].join(", "),
          border: `1px solid rgba(255, 255, 255, 0.06)`,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/marketing/hero-zod-overview.png"
          alt={`RepoBaron analysis of ${featured.repo}`}
          className="w-full h-auto block"
        />
        {/* Hover overlay — subtle black darken at the bottom on hover.
         *  Tells the user the image is clickable without shouting it.
         *  Earlier emerald tint felt "AI-template"-y; the black fade
         *  matches Apple-style enterprise polish. */}
        <div
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
          style={{
            background:
              "linear-gradient(180deg, transparent 60%, rgba(0, 0, 0, 0.35) 100%)",
          }}
        />
      </Link>
    </div>
  );
}

// ─── Two-surfaces card primitives ────────────────────────────────────

/** Side-by-side feature card used by the "Two surfaces" section.
 *  Each card has eyebrow + title + body + visual element + footer.
 *  Layout puts visual at the bottom so the text reads first, then
 *  the visual reinforces it. Lifted card style + subtle hover. */
function SurfaceCard({
  eyebrow,
  title,
  body,
  visual,
  footer,
}: {
  eyebrow: string;
  title: string;
  body: string;
  visual: React.ReactNode;
  /** ReactNode (not just string) so callers can inline-embed code
   *  tags or other formatting — e.g. the PR-bot footer renders the
   *  literal `synchronize` GitHub webhook event in inline-code. */
  footer: React.ReactNode;
}) {
  return (
    <div
      // Minimal styling — no gradient, no shadow, just a very subtle
      // border. Cards read as "sections of the page" rather than
      // "lifted boxes pasted on top". Vercel docs grid pattern.
      // Earlier lifted-card version (with shadow + gradient) made
      // the cards compete with the hero for attention.
      className="flex flex-col gap-5 p-6 rounded-xl transition-colors duration-300"
      style={{
        border: `1px solid rgba(255, 255, 255, 0.04)`,
      }}
    >
      <div className="flex flex-col gap-2">
        <span
          className="text-[10px] uppercase tracking-[0.18em] font-medium"
          style={{ color: TOK.accent }}
        >
          {eyebrow}
        </span>
        <h3
          className="text-xl font-semibold tracking-tight"
          style={{ color: TOK.textPrimary, letterSpacing: "-0.01em" }}
        >
          {title}
        </h3>
      </div>
      <p
        className="text-sm leading-relaxed"
        style={{ color: TOK.textSecondary }}
      >
        {body}
      </p>
      {visual}
      <p className="text-xs mt-1" style={{ color: TOK.textMuted }}>
        {footer}
      </p>
    </div>
  );
}

/** Visual for Workspace surface card — inline list of the 6 health
 *  dimensions RepoBaron scores. Borderless / boxless so it reads as
 *  a decorative content-element instead of a "cropped UI fragment"
 *  pasted into the card (the earlier boxed-mockup version felt
 *  detached from the surrounding card). */
function WorkspaceDimensionsMockup() {
  const tiles: { name: string; status: "healthy" | "warning" | "critical" }[] =
    [
      { name: "Activity", status: "healthy" },
      { name: "Code", status: "critical" },
      { name: "PR flow", status: "healthy" },
      { name: "Team", status: "warning" },
      { name: "Dependencies", status: "critical" },
      { name: "Hygiene", status: "healthy" },
    ];
  return (
    <div className="flex flex-col gap-3 py-1">
      <span
        className="text-[10px] uppercase tracking-[0.12em] font-medium"
        style={{ color: TOK.textMuted }}
      >
        20 signals · scored across 6 dimensions
      </span>
      <div className="grid grid-cols-3 gap-x-4 gap-y-2">
        {tiles.map((t) => {
          const color =
            t.status === "critical"
              ? TOK.rose
              : t.status === "warning"
                ? TOK.amber
                : TOK.accent;
          return (
            <div key={t.name} className="flex items-center gap-2 min-w-0">
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: color }}
              />
              <span
                className="text-xs truncate"
                style={{ color: TOK.textSecondary }}
              >
                {t.name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Visual for PR-bot surface card — compact 3-row review mockup
 *  styled like a GitHub PR comment. Bot avatar + 3 severity-tagged
 *  signal rows + "view on workspace" link. Smaller / denser than
 *  the foreground hero card; reads as a teaser, not a feature. */
function PRBotCompactMockup() {
  return (
    <div
      className="w-full rounded-lg overflow-hidden"
      style={{
        background: TOK.bg,
        border: `1px solid rgba(255,255,255,0.04)`,
      }}
    >
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{
          borderBottom: `1px solid rgba(255,255,255,0.04)`,
        }}
      >
        <div
          className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: TOK.accentSoft, color: TOK.accent }}
        >
          <Bot size={11} />
        </div>
        <span
          className="text-[11px] font-medium"
          style={{ color: TOK.textPrimary }}
        >
          repobaron-pr
        </span>
        <span
          className="text-[9px] uppercase tracking-[0.1em] font-semibold px-1 py-0.5 rounded"
          style={{
            background: TOK.surfaceElevated,
            color: TOK.textMuted,
            border: `1px solid ${TOK.border}`,
          }}
        >
          bot
        </span>
        <span
          className="text-[10px] ml-auto"
          style={{ color: TOK.textMuted }}
        >
          7m ago
        </span>
      </div>
      <div className="flex flex-col gap-2 px-3 py-2.5">
        <CompactSignalRow
          severity="critical"
          label="CRITICAL"
          text="load_dotenv grew +4 complexity. No tests changed."
        />
        <CompactSignalRow
          severity="warning"
          label="WARNING"
          text="_path_is_relative_to removed. Verify callers."
        />
        <CompactSignalRow
          severity="info"
          label="INFO"
          text="Sizeable PR — 23 files, 109 changes."
        />
      </div>
      <div
        className="flex items-center justify-end px-3 py-1.5"
        style={{ borderTop: `1px solid rgba(255,255,255,0.04)` }}
      >
        <span
          className="inline-flex items-center gap-1 text-[10px] font-medium"
          style={{ color: TOK.accent }}
        >
          View on workspace
          <ArrowUpRight size={10} />
        </span>
      </div>
    </div>
  );
}

function CompactSignalRow({
  severity,
  label,
  text,
}: {
  severity: "critical" | "warning" | "info";
  label: string;
  text: string;
}) {
  const color =
    severity === "critical"
      ? TOK.rose
      : severity === "warning"
        ? TOK.amber
        : TOK.accent;
  return (
    <div className="flex items-start gap-2">
      <span
        className="w-1 h-1 rounded-full flex-shrink-0 mt-1.5"
        style={{ background: color }}
      />
      <div
        className="text-[11px] leading-snug flex-1"
        style={{ color: TOK.textSecondary }}
      >
        <span
          className="text-[9px] uppercase tracking-[0.08em] font-semibold mr-1.5"
          style={{ color }}
        >
          {label}
        </span>
        {text}
      </div>
    </div>
  );
}

// ─── Minimalist "other demos" cards (text-only, clean) ───────────────

/** Text-only redirector cards for the non-featured demos. We tried
 *  image-cards (matching the hero) but at 33% width they read as
 *  cluttered — the screenshot + caption + arrow stacked too densely.
 *  Vercel / Linear's pattern for secondary-tier cards is text only
 *  with generous whitespace + subtle hover. That's what we mirror.
 *
 *  Severity-tinted left borders were dropped — they read as
 *  "AI-template" pattern. Clean uniform border keeps the row
 *  visually disciplined. */
function SmallDemoCard({ demo }: { demo: NormalizedDemo }) {
  const card = demo.card;
  return (
    <Link
      href={`/session/${demo.sessionId}`}
      // Reduced from gap-5 p-6 → gap-4 p-5 so cards are visually
      // tighter — was taking too much vertical space against the
      // hero. Same proportions, smaller footprint.
      className="group flex flex-col gap-4 p-5 rounded-xl cursor-pointer h-full transition-all duration-300 hover:-translate-y-0.5"
      style={{
        background: TOK.surface,
        border: `1px solid rgba(255, 255, 255, 0.06)`,
      }}
    >
      {/* Identity row — lang eyebrow + repo name (mono semibold)
       *  on left, star count on right. */}
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5 min-w-0">
          {demo.lang && (
            <span
              className="text-[10px] uppercase tracking-[0.12em] font-medium"
              style={{ color: TOK.textMuted }}
            >
              {demo.lang}
            </span>
          )}
          <span
            className="text-sm font-mono font-semibold truncate"
            style={{ color: TOK.textPrimary }}
          >
            {demo.repo}
          </span>
        </div>
        {card && card.stats.stars > 0 && (
          <span
            className="inline-flex items-center gap-1 text-xs flex-shrink-0 mt-3"
            style={{ color: TOK.textMuted }}
          >
            <Star
              size={11}
              style={{ fill: TOK.textMuted, stroke: "none" }}
            />
            {formatStarCount(card.stats.stars)}
          </span>
        )}
      </header>

      {/* Finding — one-line headline. Single source of "what's
       *  interesting here". No detail-paragraph; small cards work
       *  better with one focused signal. */}
      <p
        className="text-sm leading-snug flex-1"
        style={{ color: TOK.textSecondary }}
      >
        {card?.summary.headline.primary ?? demo.tagline}
      </p>

      {/* CTA row — arrow shifts right on hover. Minimal text so the
       *  card stays "card", not "long form". */}
      <span
        className="inline-flex items-center gap-1.5 text-xs font-medium transition-all duration-200 group-hover:gap-2.5"
        style={{ color: TOK.accent }}
      >
        See analysis
        <ArrowRight size={12} />
      </span>
    </Link>
  );
}
