// /agents — "CodeTrawl for agents": the MCP server docs + distribution page.
// Same CTSurface shell + fonts as the marketing pages. Content-heavy, so the
// sections are inline-styled with the brand palette rather than adding a wall
// of one-off classes to codetrawl.css.

import type { Metadata } from "next";
import Link from "next/link";
import { ctMono } from "@/components/landing/codetrawl/ctFonts";
import { CTSurface } from "@/components/landing/codetrawl/CTSurface";
import { CTNav } from "@/components/landing/codetrawl/CTNav";
import { CTFooter } from "@/components/landing/codetrawl/CTFooter";

export const metadata: Metadata = {
  title: "CodeTrawl for agents — blast radius over MCP",
  description:
    "Give your AI coding agent the cross-file blast radius, untested hotspots, and change-review verdicts it can't see from grep — as an MCP server. Verdicts, not queries.",
};

const MONO = ctMono.style.fontFamily;
const ORANGE = "#ff4f00";
const EMBER = "#ff8a50";
const BONE = "#eceae8";
const MUTED = "rgba(255,255,255,0.58)";
const SURFACE = "rgba(255,255,255,0.04)";
const BORDER = "rgba(255,255,255,0.10)";

const TOOLS: Array<[string, string]> = [
  ["analyze_repo", "Download + parse a GitHub repo → a session id and a compact summary. Always first."],
  ["locate_symbol", "Where is a symbol defined? A bare function, method, or class name → every definition's file and line. The lookup blast_radius needs first."],
  ["blast_radius", "What breaks if you change a file or function — cross-file reach via imports + calls, 3 hops."],
  ["simulate_change", "Simulate a proposed diff BEFORE you commit → a deterministic blast + a pass/block conscience gate. The pre-commit check."],
  ["untested_hotspots", "Production functions with no test caller, ranked by complexity — test the risky paths first."],
  ["find_duplicates", "Structurally identical functions (AST hash) across the codebase — refactor candidates."],
  ["signals", "Deterministic health verdict: what works, what needs work, what needs human judgment."],
  ["compare_sessions", "High-level diff of two analyses — verify a refactor actually moved the needle."],
  ["analyze_diff", "Function-level diff, PR-comment-grade: every change classified with a complexity delta."],
  ["review_changes", "Prioritized verification suggestions on a diff, each with severity + evidence."],
];

const RECIPE = `## Before you change code — and before you call it done

This repo is connected to the CodeTrawl MCP server.

Before you edit:
1. Call analyze_repo once with the repo URL to get a session id.
2. Call blast_radius on the file/function you're about to change — read
   the dependents and how many are untested before you commit to the edit.

Before you finish — the conscience loop:
3. Call simulate_change with your FULL proposed diff.
4. If gate.pass is false, resolve each gate.blocking item (load-bearing
   code with no guarding test, a hollow test) or justify it, then
   re-simulate. Repeat until gate.pass is true.

The verdict is deterministic — computed from the real import + call graph,
cited to concrete files. Treat gate.pass:false as a stop, not a warning.
(Or invoke the "conscience" prompt to load this loop verbatim.)`;

function Code({ children }: { children: string }) {
  return (
    <pre
      style={{
        fontFamily: MONO,
        fontSize: 13.5,
        lineHeight: 1.6,
        color: BONE,
        background: "rgba(0,0,0,0.35)",
        border: `1px solid ${BORDER}`,
        borderRadius: 10,
        padding: "14px 16px",
        overflowX: "auto",
        margin: 0,
        whiteSpace: "pre",
      }}
    >
      {children}
    </pre>
  );
}

function Section({
  eyebrow,
  title,
  children,
  centered = false,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
  /** Center the eyebrow + heading + body — used for the pitch section so it
   *  reads as a continuation of the centered hero, not a jump to the left. */
  centered?: boolean;
}) {
  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 18,
        marginTop: 64,
        alignItems: centered ? "center" : "stretch",
        textAlign: centered ? "center" : "left",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          alignItems: centered ? "center" : "stretch",
        }}
      >
        <span style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.14em", color: EMBER }}>
          {eyebrow}
        </span>
        <h2 style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em", margin: 0, color: BONE }}>
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

export default function AgentsPage() {
  return (
    <CTSurface>
      <CTNav />

      <main className="wrap" style={{ paddingBottom: 96 }}>
        <header
          className="price-hero"
          style={{ maxWidth: 720, marginLeft: "auto", marginRight: "auto" }}
        >
          <span className="eyebrow">For agents · MCP server</span>
          <h1>Give your agent the blast radius.</h1>
          <p className="lede">
            AI agents plan on the three files they grepped, then miss the
            cross-cutting effects. CodeTrawl exposes the code graph as an{" "}
            <strong style={{ color: BONE }}>MCP server</strong> — so Claude
            Code, Cursor, or anything that speaks MCP can ask{" "}
            <em>&ldquo;what breaks if I change this?&rdquo;</em>{" "}
            <strong style={{ color: BONE }}>before</strong> it edits. Verdicts,
            not queries. No LLM in the analysis path.
          </p>
        </header>

        <Section eyebrow="The idea" title="Verdicts, not queries" centered>
          <p style={{ fontSize: 16, lineHeight: 1.7, color: MUTED, maxWidth: 680, margin: 0 }}>
            Raw graph access over MCP measurably <em>degrades</em>{" "}
            agent answers
            — a graph dump is just more tokens to get lost in. CodeTrawl ships
            ranked verdicts instead: the blast radius of a change, the untested
            files it would break, the duplicated code it would leave stale. It&rsquo;s
            pre-planning context — repo-at-commit, deterministic, cited to the
            call graph — not a live view of unsaved edits.
          </p>
        </Section>

        <Section eyebrow="Ten tools" title="What your agent can call">
          <div style={{ display: "flex", flexDirection: "column", borderRadius: 12, overflow: "hidden", border: `1px solid ${BORDER}` }}>
            {TOOLS.map(([name, desc], i) => (
              <div
                key={name}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(150px, 200px) 1fr",
                  gap: 16,
                  padding: "13px 16px",
                  background: i % 2 === 0 ? SURFACE : "transparent",
                  borderTop: i === 0 ? "none" : `1px solid ${BORDER}`,
                  alignItems: "baseline",
                }}
              >
                <code style={{ fontFamily: MONO, fontSize: 13.5, color: EMBER }}>{name}</code>
                <span style={{ fontSize: 14.5, lineHeight: 1.55, color: MUTED }}>{desc}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section eyebrow="Install" title="Wire it to your client">
          <p style={{ fontSize: 15, color: MUTED, margin: 0 }}>
            One command. Published on npm as{" "}
            <code style={{ fontFamily: MONO, color: EMBER }}>codetrawl-mcp</code>
            {" "}— nothing to clone and nothing to build. The analysis runs on
            your machine; no CodeTrawl-controlled server sees your repos.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
            <div>
              <div style={{ fontSize: 13, color: MUTED, marginBottom: 6 }}>Claude Code</div>
              <Code>{`claude mcp add codetrawl npx codetrawl-mcp`}</Code>
            </div>
            <div>
              <div style={{ fontSize: 13, color: MUTED, marginBottom: 6 }}>Cursor / Cline / others (JSON config)</div>
              <Code>{`{
  "mcpServers": {
    "codetrawl": {
      "command": "npx",
      "args": ["-y", "codetrawl-mcp"]
    }
  }
}`}</Code>
            </div>
          </div>
        </Section>

        <Section eyebrow="Pre-flight recipe" title="Make the agent actually use it">
          <p style={{ fontSize: 15, color: MUTED, margin: 0, maxWidth: 680 }}>
            Agents that grep don&rsquo;t call tools they don&rsquo;t know they need. Drop
            this into your project&rsquo;s{" "}
            <code style={{ fontFamily: MONO, color: EMBER }}>AGENTS.md</code> /{" "}
            <code style={{ fontFamily: MONO, color: EMBER }}>CLAUDE.md</code> so it
            reaches for the blast radius before touching load-bearing code.
          </p>
          <Code>{RECIPE}</Code>
        </Section>

        <div
          style={{
            marginTop: 64,
            padding: "24px 28px",
            borderRadius: 14,
            background: `radial-gradient(120% 120% at 100% 0%, rgba(255,79,0,0.10), transparent 60%), ${SURFACE}`,
            border: `1px solid ${BORDER}`,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, color: BONE }}>
              Try the analysis in the browser first.
            </div>
            <div style={{ fontSize: 14.5, color: MUTED, marginTop: 4 }}>
              Paste a repo, see the blast radius the tools return — then wire it
              to your agent.
            </div>
          </div>
          <Link
            href="/#top"
            style={{
              fontFamily: "inherit",
              fontSize: 15,
              fontWeight: 600,
              color: "#0c0b0b",
              background: ORANGE,
              borderRadius: 10,
              padding: "11px 20px",
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            Analyze a repo →
          </Link>
        </div>
      </main>

      <CTFooter />
    </CTSurface>
  );
}
