// Landing page — Linear-lighter direction.
//
// Section order chosen for the dual-audience problem: this URL serves
// BOTH first-time visitors (HN/Reddit traffic — need the marketing
// pitch) and returning users (need their sessions fast). v0.49 puts
// the sessions list above the "What you'll see" feature grid so
// returning users don't scroll past 6 marketing cards to find their
// own work; first-time visitors see an empty-state nudge and read on.

import { listSessions } from "@/lib/storage";
import { STYLE, TOK } from "@/lib/theme";
import { RepoInputForm, type DemoRepo } from "@/components/RepoInputForm";
import { HomeSessionsList } from "@/components/HomeSessionsList";

export const dynamic = "force-dynamic";

// Curated demo set. One entry per AST-backed plugin so the row showcases
// the plugin architecture at a glance. Each pick is small/medium-sized —
// large repos like vercel/next.js or torvalds/linux risk hitting the 25s
// codeAnalysis timeout (see lib/github.ts) and degrading to "Code analysis
// was skipped", which is a poor first impression.
const DEMO_REPOS: DemoRepo[] = [
  { repo: "colinhacks/zod", lang: "TypeScript" },
  { repo: "gin-gonic/gin", lang: "Go" },
  { repo: "pallets/flask", lang: "Python" },
  { repo: "spring-projects/spring-petclinic", lang: "Java" },
];

export default async function Home() {
  const sessions = await listSessions();

  return (
    <main className="max-w-5xl w-full mx-auto px-8 pt-16 pb-20 flex flex-col gap-16">
      {/* Hero */}
      <section className="flex flex-col gap-7">
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
            Find what&apos;s risky, duplicated, or untested.
          </span>
        </h1>

        <p
          className="text-lg max-w-2xl leading-relaxed"
          style={{ color: TOK.textSecondary }}
        >
          Paste a URL. Get blast radius, structural duplicates, untested
          hotspots, and an AI health verdict grounded in 17 deterministic
          signals — in under 20 seconds, across 7 languages.
        </p>

        <RepoInputForm demoRepos={DEMO_REPOS} />
      </section>

      {/* Sessions — filtered client-side by anonymous owner-id (v0.26+).
       *  Promoted above "What you'll see" in v0.49 so returning users
       *  hit their work first instead of scrolling past marketing. */}
      <HomeSessionsList initialSessions={sessions} />

      {/* What you'll see — feature-specific cards highlighting the
       *  insight panels users get on a session page. v0.49 trimmed
       *  from 6 to 3, focused on the most differentiating findings:
       *  things GitHub Insights doesn't give you. The other 3
       *  (untested hotspots, dependency health, refresh story) are
       *  great features but less unique angles for first-impression
       *  marketing. */}
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
              t: "AI health verdict",
              d: "17 deterministic signals feed a constrained Claude narrative. Every claim grounded in real data — zero hallucination.",
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

      {/* Footer. Feedback link is opt-in via env: set
       *  NEXT_PUBLIC_FEEDBACK_URL to a Tally / Cal.com / Typeform URL
       *  to surface a dedicated "Feedback" link. Otherwise we point
       *  at GitHub Issues, which is always-available. */}
      <footer
        className="pt-8 text-xs flex items-center justify-between border-t flex-wrap gap-3"
        style={{ borderColor: TOK.border, color: TOK.textMuted }}
      >
        <span>GitVision · made by SoosFire</span>
        <div className="flex items-center gap-3 flex-wrap">
          <a
            href="https://github.com/SoosFire/gitvision"
            target="_blank"
            rel="noopener"
            className="transition hover:underline"
          >
            GitHub
          </a>
          <span style={{ color: TOK.border }}>·</span>
          <a
            href={
              process.env.NEXT_PUBLIC_FEEDBACK_URL ??
              "https://github.com/SoosFire/gitvision/issues"
            }
            target="_blank"
            rel="noopener"
            className="transition hover:underline"
          >
            Feedback
          </a>
          <span style={{ color: TOK.border }}>·</span>
          <a href="/legal" className="transition hover:underline">
            Privacy &amp; terms
          </a>
          <span style={{ color: TOK.border }}>·</span>
          <span>PolyForm Noncommercial</span>
        </div>
      </footer>
    </main>
  );
}
