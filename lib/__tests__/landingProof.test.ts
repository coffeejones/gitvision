// The landing page's numbers must not rot.
//
// A figure on a marketing page is a claim with no compiler behind it. "17-signal
// health verdict" sat in the MCP server's own tool description while
// lib/signals.ts emitted 33 ids, and two code comments still described the v0.10
// world where JS/TS was the only tree-sitter plugin — six migrations after the
// fact. Nobody was careless; a number in prose simply has nothing that fails
// when the code moves past it.
//
// This is that thing. Add a language, an ecosystem, an MCP tool or a curated
// incident and the corresponding assertion fails, which is the moment to decide
// whether the landing should say a bigger number — rather than discovering years
// later that it says a smaller one.
//
// The figures live in the marketing component rather than being derived at
// render time on purpose: importing the plugin registry to count languages
// would pull web-tree-sitter and eight WASM grammars into the landing bundle to
// produce a "7". The cost of that is real; the cost of this test is nothing.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { PROOF_STATS } from "../../components/landing/codetrawl/CTProof";
import { ALL_PLUGINS } from "../codeAnalysis/plugins/all";
import { KNOWN_INCIDENTS } from "../security/knownIncidents";

/** The figure shown for a stat, by the page it links to. */
function figureFor(href: string): number {
  const stat = PROOF_STATS.find((s) => s.href === href);
  if (!stat) throw new Error(`no landing stat links to ${href}`);
  return Number(stat.figure);
}

describe("landing proof strip stays true", () => {
  it("claims exactly as many languages as have a real call graph", () => {
    // The regex fallback yields imports only — it is not a language with a call
    // graph, and counting it would overstate what the page promises.
    const withCallGraph = ALL_PLUGINS.filter(
      (p) => p.name !== "regex-fallback",
    );
    expect(figureFor("/help")).toBe(withCallGraph.length);
  });

  it("names every one of those languages in the detail line", () => {
    // A count is a claim; the list is checkable. If a plugin lands and the
    // sentence is not updated, the page is quietly wrong about which stack it
    // supports — the single most likely reason a visitor bounces.
    const detail =
      PROOF_STATS.find((s) => s.href === "/help")?.detail.toLowerCase() ?? "";
    const expected: Record<string, string> = {
      javascript: "javascript/typescript",
      python: "python",
      go: "go",
      java: "java",
      csharp: "c#",
      php: "php",
      ruby: "ruby",
    };
    for (const plugin of ALL_PLUGINS) {
      if (plugin.name === "regex-fallback") continue;
      const needle = expected[plugin.name];
      expect(
        needle,
        `plugin "${plugin.name}" has no expected display name — add it here and to the landing copy`,
      ).toBeDefined();
      expect(
        detail.includes(needle),
        `the landing does not name "${plugin.name}" among the languages it reads`,
      ).toBe(true);
    }
  });

  it("claims exactly as many curated incidents as are curated", () => {
    expect(figureFor("/exposure")).toBe(KNOWN_INCIDENTS.length);
  });

  it("claims exactly as many MCP tools as the server registers", () => {
    const src = readFileSync(
      path.join(process.cwd(), "mcp", "buildServer.ts"),
      "utf-8",
    );
    const registered = (src.match(/server\.registerTool\(/g) ?? []).length;
    expect(registered, "expected the MCP server to register tools").toBeGreaterThan(0);
    expect(figureFor("/agents")).toBe(registered);
  });

  it("keeps the /agents page's own tool count in step", () => {
    // The page prints an eyebrow ("Ten tools") and a table. Both drift the same
    // way the landing does.
    const src = readFileSync(
      path.join(process.cwd(), "app", "agents", "page.tsx"),
      "utf-8",
    );
    const rows = (src.match(/^\s*\["[a-z_]+",/gm) ?? []).length;
    expect(rows).toBe(figureFor("/agents"));
  });

  it("states zero AI in the analysis, and the analysis job imports no model client", () => {
    expect(figureFor("/security")).toBe(0);
    // The claim is only worth printing if it is structurally true: the job that
    // runs an analysis must not reach an Anthropic client, directly or through
    // the analyzer.
    for (const file of ["jobs.ts", "github.ts"]) {
      const src = readFileSync(path.join(process.cwd(), "lib", file), "utf-8");
      expect(
        /from ["']@anthropic-ai\/sdk["']/.test(src),
        `lib/${file} imports the Anthropic SDK — the landing claims no AI in the analysis`,
      ).toBe(false);
    }
  });

  it("every figure links to a page that exists", () => {
    for (const stat of PROOF_STATS) {
      const route = path.join(
        process.cwd(),
        "app",
        stat.href.replace(/^\//, ""),
      );
      const entries = readdirSync(route);
      expect(
        entries.includes("page.tsx"),
        `${stat.href} has no page.tsx — the landing links somewhere that 404s`,
      ).toBe(true);
    }
  });
});
