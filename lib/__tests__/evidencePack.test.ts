// Coverage for the evidence-pack builder (lib/evidencePack/build.ts).

import { describe, it, expect } from "vitest";
import type { AnalysisSnapshot, Session } from "../types";
import {
  buildEvidenceObject,
  collectEvidenceFiles,
  evidenceBaseName,
} from "../evidencePack/build";

function snap(overrides: Partial<AnalysisSnapshot> = {}): AnalysisSnapshot {
  return {
    fetchedAt: "2026-07-08T00:00:00Z",
    analyzedRef: "abc123",
    repo: {
      owner: "octocat",
      name: "Hello-World",
      fullName: "octocat/Hello-World",
      description: "Test",
      stars: 0,
      forks: 0,
      watchers: 0,
      openIssues: 0,
      defaultBranch: "main",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2026-07-01T00:00:00Z",
      pushedAt: "2026-07-01T00:00:00Z",
      language: "TypeScript",
      license: "MIT",
      homepage: null,
      topics: [],
    },
    contributors: [],
    languages: {},
    recentCommits: [],
    hotspots: [],
    coChange: [],
    commitActivity: [],
    hasReadme: true,
    ...overrides,
  } as AnalysisSnapshot;
}

const depHealth = {
  ecosystem: "npm",
  total: 3,
  uniquePackages: 3,
  outdated: [],
  vulnerable: [{ name: "lodash", current: "4.17.19", cves: ["CVE-2021-23337"] }],
  deprecated: [],
  analyzedAt: "2026-07-08T00:00:00Z",
  components: [
    { name: "lodash", version: "4.17.19", scope: "runtime" },
    { name: "jest", version: "29.0.0", scope: "dev" },
  ],
};

function session(over: Partial<AnalysisSnapshot> = {}): Session {
  const s2 = snap({
    dependencyHealths: [depHealth],
    ciHardening: {
      workflowCount: 2,
      actions: [],
      unpinned: [],
      permissions: [],
      posture: "attention",
      findings: [
        { id: "unpinned-actions", severity: "high", title: "1 action unpinned", count: 1, evidence: [] },
      ],
    },
    secretFindings: {
      findings: [{ severity: "high", preview: "SECRETPREVIEW_ABC123" }],
    },
    ...over,
  } as Partial<AnalysisSnapshot>);
  const s1 = snap({ fetchedAt: "2026-06-01T00:00:00Z", analyzedRef: "old111" });
  return { id: "s1", snapshots: [s1, s2] } as unknown as Session;
}

describe("collectEvidenceFiles", () => {
  it("bundles evidence.json + SUMMARY.md + both SBOMs when components exist", () => {
    const files = collectEvidenceFiles(session());
    const names = files.map((f) => f.name).sort();
    expect(names).toEqual(["SUMMARY.md", "evidence.json", "sbom.cdx.json", "sbom.spdx.json"]);
  });

  it("omits the SBOM files when the snapshot has no captured components", () => {
    const files = collectEvidenceFiles(session({ dependencyHealths: [] }));
    const names = files.map((f) => f.name).sort();
    expect(names).toEqual(["SUMMARY.md", "evidence.json"]);
  });

  it("NEVER includes raw/redacted secret values — only severity counts", () => {
    const files = collectEvidenceFiles(session());
    const blob = files.map((f) => f.content).join("\n");
    expect(blob).not.toContain("SECRETPREVIEW_ABC123");
    const evidence = buildEvidenceObject(session());
    expect(evidence.secretHygiene.findingsBySeverity.high).toBe(1);
    expect(evidence.secretHygiene.note).toMatch(/never included/i);
  });
});

describe("buildEvidenceObject", () => {
  it("captures repo, verdict, dependencies, CI, and the re-sweep trail", () => {
    const e = buildEvidenceObject(session());
    expect(e.repository.name).toBe("octocat/Hello-World");
    expect(e.repository.ref).toBe("abc123");
    expect(typeof e.verdict.grade).toBe("string");
    expect(e.scope).toMatch(/manifest-based/i);
    expect(e.dependencies.ecosystems[0]).toMatchObject({ ecosystem: "npm", total: 3, vulnerable: 1 });
    expect(e.dependencies.vulnerable[0]).toMatchObject({ name: "lodash", cves: ["CVE-2021-23337"] });
    expect(e.ciHardening?.posture).toBe("attention");
    // one trail entry per snapshot, oldest → newest
    expect(e.reSweepTrail).toHaveLength(2);
    expect(e.reSweepTrail[0].ref).toBe("old111");
    expect(e.sbom.included).toBe(true);
  });

  it("marks the SBOM not-included when there are no components", () => {
    const e = buildEvidenceObject(session({ dependencyHealths: [] }));
    expect(e.sbom.included).toBe(false);
  });

  it("SUMMARY.md is markdown with the key sections + the vulnerable package", () => {
    const md = collectEvidenceFiles(session()).find((f) => f.name === "SUMMARY.md")!.content;
    expect(md).toContain("# CodeTrawl evidence pack");
    expect(md).toContain("## Scope");
    expect(md).toContain("## Re-sweep trail");
    expect(md).toContain("lodash@4.17.19");
  });
});

describe("evidenceBaseName", () => {
  it("slugifies repo + snapshot date", () => {
    expect(evidenceBaseName(session())).toBe("codetrawl-evidence-octocat-hello-world-2026-07-08");
  });
});
