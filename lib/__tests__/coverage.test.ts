// The difference between "we looked and found nothing" and "we never looked".
//
// Measured on the sessions in .gitvision/sessions: 11 of 22 have no dependency
// data at all — 7 of 10 distinct repos — and the Packages tab told every one of
// them "No package manifests detected in this repo". gin declares its packages
// in go.mod, petclinic in pom.xml, rspec in a .gemspec, serilog in six .csproj
// files. All were seen by the walker. None were read. "Detected" was the wrong
// word for a coverage limit.
//
// Same shape on Security: sink rules live in exactly two plugins, so a Java or
// Go repo is parsed for structure and then examined for injection by nothing,
// and reports zero findings.
//
// These tests exist because the copy is only worth printing if the numbers in
// it are real. Every assertion below runs against either a fixture built to
// isolate one rule, or a session on disk.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import type { AnalysisSnapshot } from "../types";
import {
  describeUnreadEcosystem,
  describeUncheckedLanguages,
  SINK_RULE_PLUGINS,
} from "../coverage";

const session = (id: string): AnalysisSnapshot =>
  JSON.parse(
    readFileSync(path.join(process.cwd(), ".gitvision", "sessions", `${id}.json`), "utf-8"),
  ).snapshots.at(-1);

function snap(over: Partial<AnalysisSnapshot> = {}): AnalysisSnapshot {
  return {
    fetchedAt: "2026-08-05T00:00:00.000Z",
    repo: { fullName: "acme/widget" },
    languages: {},
    hotspots: [],
    ...over,
  } as unknown as AnalysisSnapshot;
}

describe("describeUnreadEcosystem", () => {
  it("says nothing when dependencies WERE read", () => {
    // The most important negative. A caveat on a repo we did check would be
    // noise, and noise is how the honest ones get skipped.
    const s = snap({
      dependencyHealths: [{ ecosystem: "npm", outdated: [], vulnerable: [], deprecated: [] }],
      hotspots: [{ path: "go.mod" }],
    } as unknown as Partial<AnalysisSnapshot>);
    expect(describeUnreadEcosystem(s)).toBeNull();
  });

  it("names the ecosystem and the file it did not read", () => {
    const s = snap({
      languages: { Go: 1000 },
      hotspots: [{ path: "go.mod" }, { path: "main.go" }],
    } as unknown as Partial<AnalysisSnapshot>);
    expect(describeUnreadEcosystem(s)).toEqual({
      ecosystem: "Go modules",
      manifests: ["go.mod"],
      language: "Go",
    });
  });

  it("finds a manifest through any of the three walks", () => {
    // hotspots, the code parser's file list, and the import graph see different
    // parts of a repo. A manifest only has to appear in ONE of them.
    const viaComplexity = snap({
      languages: { Java: 5 },
      codeGraph: { fileComplexity: { "pom.xml": 1 } },
    } as unknown as Partial<AnalysisSnapshot>);
    const viaGraph = snap({
      languages: { Java: 5 },
      fileGraph: { nodes: [{ path: "pom.xml" }] },
    } as unknown as Partial<AnalysisSnapshot>);
    expect(describeUnreadEcosystem(viaComplexity)?.ecosystem).toBe("Maven");
    expect(describeUnreadEcosystem(viaGraph)?.ecosystem).toBe("Maven");
  });

  it("prefers the shallowest manifest", () => {
    // serilog surfaces six .csproj files. "src/Serilog/Serilog.csproj" tells
    // the story; a test project three directories down does not.
    const s = snap({
      languages: { "C#": 9 },
      hotspots: [
        { path: "test/Serilog.Tests/Serilog.Tests.csproj" },
        { path: "src/Serilog/Serilog.csproj" },
      ],
    } as unknown as Partial<AnalysisSnapshot>);
    expect(describeUnreadEcosystem(s)!.manifests[0]).toBe("src/Serilog/Serilog.csproj");
  });

  it("falls back to the language when no manifest surfaced", () => {
    // RaceKatteKlubben's pom.xml is buried under committed .idea/ and target/
    // output and never reaches the top-120 hotspots. The language still carries
    // the message.
    const s = snap({ languages: { Java: 520, HTML: 480 } });
    expect(describeUnreadEcosystem(s)).toEqual({
      ecosystem: null,
      manifests: [],
      language: "Java",
    });
  });

  it("stays silent when there is nothing concrete to point at", () => {
    // No manifest, no language. An apology with no evidence in it is worse
    // than saying nothing.
    expect(describeUnreadEcosystem(snap())).toBeNull();
  });

  it("does not mistake a manifest we DO read for one we do not", () => {
    const s = snap({
      languages: { TypeScript: 9 },
      hotspots: [{ path: "package.json" }, { path: "Cargo.toml" }],
    } as unknown as Partial<AnalysisSnapshot>);
    // No dependencyHealths, but nothing in the unread list matched, so the only
    // honest thing left is the language.
    expect(describeUnreadEcosystem(s)!.ecosystem).toBeNull();
  });
});

describe("describeUncheckedLanguages", () => {
  it("names the plugins that ran without security rules", () => {
    const s = snap({
      codeGraph: { byPlugin: { java: { files: 47 }, "regex-fallback": { files: 12 } } },
    } as unknown as Partial<AnalysisSnapshot>);
    expect(describeUncheckedLanguages(s)).toEqual({
      plugins: ["java"],
      files: 47,
      none: true,
    });
  });

  it("reports none=false when a rule-carrying plugin also ran", () => {
    // A mixed repo. Java went unchecked, but Python files WERE examined, so
    // "0 findings" is not entirely vacuous and the copy must not say it is.
    const s = snap({
      codeGraph: { byPlugin: { java: { files: 40 }, python: { files: 12 } } },
    } as unknown as Partial<AnalysisSnapshot>);
    expect(describeUncheckedLanguages(s)).toMatchObject({ plugins: ["java"], none: false });
  });

  it("says nothing when every plugin that ran carries rules", () => {
    const s = snap({
      codeGraph: { byPlugin: { javascript: { files: 400 }, python: { files: 9 } } },
    } as unknown as Partial<AnalysisSnapshot>);
    expect(describeUncheckedLanguages(s)).toBeNull();
  });

  it("ignores the regex fallback", () => {
    // HTML and CSS produce no call graph at all — that is the "nothing was
    // parsed" gap, and mixing the two messages helps nobody.
    const s = snap({
      codeGraph: { byPlugin: { python: { files: 83 }, "regex-fallback": { files: 22 } } },
    } as unknown as Partial<AnalysisSnapshot>);
    expect(describeUncheckedLanguages(s)).toBeNull();
  });

  it("says nothing when there is no graph at all", () => {
    expect(describeUncheckedLanguages(snap())).toBeNull();
  });
});

describe("SINK_RULE_PLUGINS matches the plugins that define sinks", () => {
  it("is not a list that can quietly rot", () => {
    // The whole panel rests on this set. If someone adds sink rules to the Go
    // plugin and forgets this file, CodeTrawl would keep telling Go users their
    // code was never examined — the exact inverse of the bug being fixed.
    const dir = path.join(process.cwd(), "lib", "codeAnalysis", "plugins");
    const withRules = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && !f.includes(".test."))
      .filter((f) => {
        const src = readFileSync(path.join(dir, f), "utf-8");
        // A plugin that DEFINES rules, not one that merely mentions the word.
        return /\bsinks\s*[:.]/.test(src) || /SINK_RULES/.test(src);
      })
      .map((f) => f.replace(/\.ts$/, ""));

    expect(withRules.length, "no plugin appears to define sinks — the probe is broken").toBeGreaterThan(0);
    expect([...SINK_RULE_PLUGINS].sort()).toEqual(withRules.sort());
  });
});

describe("on the sessions this was written for", () => {
  it.each([
    ["gx1lLA07kO", "gin-gonic/gin", "Go modules", "go"],
    ["PGlVvQRlAh", "spring-petclinic", "Maven", "java"],
    ["xEHUPsZ73L", "rspec/rspec-core", "RubyGems", "ruby"],
    ["XmCB5--NkT", "serilog/serilog", "NuGet", "csharp"],
  ])("%s (%s)", (id, _name, ecosystem, plugin) => {
    const s = session(id);
    const eco = describeUnreadEcosystem(s);
    expect(eco, "dependency data appeared — re-pick the fixture").not.toBeNull();
    expect(eco!.ecosystem).toBe(ecosystem);
    expect(eco!.manifests.length).toBeGreaterThan(0);

    const unchecked = describeUncheckedLanguages(s);
    expect(unchecked!.plugins).toContain(plugin);
    expect(unchecked!.none, "a rule-carrying plugin ran after all").toBe(true);
  });

  it("stays quiet on a repo we fully cover", () => {
    // zod is npm + TypeScript: dependencies read, sink rules applied. Neither
    // message may appear, or the panel is noise everywhere.
    const s = session("DBtU3d_Gfk");
    expect(describeUnreadEcosystem(s)).toBeNull();
    expect(describeUncheckedLanguages(s)).toBeNull();
  });
});
