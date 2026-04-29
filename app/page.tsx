// Landing page — Linear-lighter direction.
// URL input, demo chips, how-it-works, saved sessions as a clean list.

import { listSessions } from "@/lib/storage";
import { TOK } from "@/lib/theme";
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
          See any repo as{" "}
          <span style={{ color: TOK.accent }}>a living map</span>.
        </h1>

        <p
          className="text-lg max-w-xl leading-relaxed"
          style={{ color: TOK.textSecondary }}
        >
          Paste a GitHub URL. Get an explorable canvas, an honest health
          verdict, and an AI briefing — in under 20 seconds.
        </p>

        <RepoInputForm demoRepos={DEMO_REPOS} />
      </section>

      {/* How it works */}
      <section className="flex flex-col gap-8">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em]">
            How it works
          </h2>
          <div className="text-xs" style={{ color: TOK.textMuted }}>
            ~20 seconds end-to-end
          </div>
        </div>

        <div
          className="grid grid-cols-1 md:grid-cols-3 gap-px overflow-hidden rounded-xl"
          style={{ background: TOK.border }}
        >
          {[
            {
              n: "01",
              t: "Paste",
              d: "Any public GitHub URL. No auth needed for public repos.",
            },
            {
              n: "02",
              t: "Analyze",
              d: "We clone history with git log, parse imports, fetch PRs, compute signals.",
            },
            {
              n: "03",
              t: "Explore",
              d: "Canvas, dependency graph, PR flow, health check. Save as a session.",
            },
          ].map((s) => (
            <div
              key={s.n}
              className="p-6 flex flex-col gap-3"
              style={{ background: TOK.bg }}
            >
              <span
                className="font-mono text-sm"
                style={{ color: TOK.accent }}
              >
                {s.n}
              </span>
              <h3 className="text-base font-semibold">{s.t}</h3>
              <p
                className="text-sm leading-relaxed"
                style={{ color: TOK.textSecondary }}
              >
                {s.d}
              </p>
            </div>
          ))}
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
          <span>PolyForm Noncommercial</span>
        </div>
      </footer>
    </main>
  );
}
