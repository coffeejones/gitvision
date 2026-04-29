// Landing page — Linear-lighter direction.
// URL input, demo chips, how-it-works, saved sessions as a clean list.

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
    <main className="max-w-5xl w-full mx-auto px-8 pt-16 pb-20 flex flex-col gap-24">
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

      {/* What you'll see — feature-specific cards highlighting the
       *  insight panels users get on a session page. Concrete + screenshot-
       *  worthy claims, not generic "explore your code". */}
      <section className="flex flex-col gap-8">
        <div className="flex items-baseline justify-between">
          <h2 className={STYLE.sectionTitle}>What you&apos;ll see</h2>
          <div className="text-xs" style={{ color: TOK.textMuted }}>
            on every session page
          </div>
        </div>

        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px overflow-hidden rounded-xl"
          style={{ background: TOK.border }}
        >
          {[
            {
              t: "Blast radius",
              d: "Click a file, see what breaks if you change it. Click a function, zoom into callers and callees three hops deep.",
            },
            {
              t: "Near-duplicates",
              d: "Structural AST hashing across the codebase. On golang/go src/cmd we found 36 copies of one ARM rewrite pattern.",
            },
            {
              t: "Untested hotspots",
              d: "Most-complex production functions with no test caller. Per-file coverage badges scaled by ratio.",
            },
            {
              t: "AI health verdict",
              d: "Hybrid: 17 deterministic rule-based signals feed a constrained Claude narrative. Zero hallucination room.",
            },
            {
              t: "Dependency health",
              d: "Vulnerable / outdated / deprecated packages across npm, Cargo, PyPI. CVEs from OSV.dev with direct registry links.",
            },
            {
              t: "Refresh story",
              d: "Snapshot diffs become a screenshot-worthy hero card: complexity grew, new functions added, who&apos;s the new top committer.",
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

        <div
          className="text-xs"
          style={{ color: TOK.textMuted }}
        >
          Tree-sitter AST across JS/TS, Python, Go, Java, C#, PHP, Ruby.
          Kotlin via regex fallback (imports only). Big monorepos? Paste
          a deep-link to a subdirectory to scope the analysis.
        </div>
      </section>

      {/* Sessions — filtered client-side by anonymous owner-id (v0.26+) */}
      <HomeSessionsList initialSessions={sessions} />

      {/* Footer */}
      <footer
        className="pt-8 text-xs flex items-center justify-between border-t"
        style={{ borderColor: TOK.border, color: TOK.textMuted }}
      >
        <span>GitVision · made by SoosFire</span>
        <div className="flex items-center gap-3">
          <a
            href="https://github.com/SoosFire/gitvision"
            target="_blank"
            rel="noopener"
            className="transition hover:underline"
          >
            GitHub
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
