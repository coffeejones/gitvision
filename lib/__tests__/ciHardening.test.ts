// Coverage for the CI-hardening detectors (lib/ciHardening/analyze.ts).

import { describe, it, expect } from "vitest";
import { analyzeWorkflows } from "../ciHardening/analyze";

const SHA = "1234567890abcdef1234567890abcdef12345678";

function wf(path: string, content: string) {
  return { path, content };
}

describe("analyzeWorkflows", () => {
  it("returns undefined when there are no workflows", () => {
    expect(analyzeWorkflows([], "myorg")).toBeUndefined();
  });

  it("skips malformed YAML rather than tanking the report", () => {
    expect(analyzeWorkflows([wf("ci.yml", "name: [unclosed")], "myorg")).toBeUndefined();
  });

  it("flags a third-party action pinned to a mutable tag as high (tj-actions)", () => {
    const report = analyzeWorkflows(
      [
        wf(
          ".github/workflows/ci.yml",
          `
name: CI
permissions: write-all
jobs:
  build:
    steps:
      - uses: actions/checkout@v4
      - uses: tj-actions/changed-files@v35
      - uses: pinned/action@${SHA}
      - uses: ./.github/actions/local
`,
        ),
      ],
      "myorg",
    );
    expect(report).toBeDefined();
    expect(report!.workflowCount).toBe(1);

    // checkout@v4 (tag) + tj-actions@v35 (tag) are unpinned; the SHA + local are not
    expect(report!.unpinned.map((a) => a.ref).sort()).toEqual([
      "actions/checkout",
      "tj-actions/changed-files",
    ]);

    const unpinned = report!.findings.find((f) => f.id === "unpinned-actions")!;
    expect(unpinned.severity).toBe("high"); // driven by the third-party one
    expect(unpinned.incident?.name).toContain("tj-actions");

    // third-party inventory: tj-actions + pinned/action (not checkout, not local)
    const inv = report!.findings.find((f) => f.id === "third-party-actions")!;
    expect(inv.count).toBe(2);

    // write-all → high broad-permissions
    const perms = report!.findings.find((f) => f.id === "broad-permissions")!;
    expect(perms.severity).toBe("high");

    expect(report!.posture).toBe("exposed");
  });

  it("treats SHA-pinned first-party actions with least-privilege perms as hardened", () => {
    const report = analyzeWorkflows(
      [
        wf(
          "ci.yml",
          `
name: CI
permissions:
  contents: read
jobs:
  build:
    steps:
      - uses: actions/checkout@${SHA}
`,
        ),
      ],
      "myorg",
    );
    expect(report!.findings).toEqual([]);
    expect(report!.posture).toBe("hardened");
  });

  it("flags an unspecified top-level token scope as medium (inherits broad default)", () => {
    const report = analyzeWorkflows(
      [
        wf(
          "ci.yml",
          `
name: CI
jobs:
  build:
    steps:
      - uses: actions/checkout@${SHA}
`,
        ),
      ],
      "myorg",
    );
    const perms = report!.findings.find((f) => f.id === "broad-permissions")!;
    expect(perms.severity).toBe("medium");
    expect(report!.posture).toBe("attention");
  });

  it("does not count a same-owner action as third-party", () => {
    const report = analyzeWorkflows(
      [
        wf(
          "ci.yml",
          `
name: CI
permissions:
  contents: read
jobs:
  build:
    steps:
      - uses: myorg/internal-action@v1
`,
        ),
      ],
      "myorg",
    );
    // myorg-owned → not third-party, so no inventory finding; but it's a mutable
    // tag → first-party-style unpinned (medium, not high).
    expect(report!.findings.find((f) => f.id === "third-party-actions")).toBeUndefined();
    const unpinned = report!.findings.find((f) => f.id === "unpinned-actions")!;
    expect(unpinned.severity).toBe("medium");
  });
});

describe("analyzeWorkflows — finding prose", () => {
  const wfBroad = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      path: `.github/workflows/w${i}.yml`,
      content: "on: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n",
    }));

  it("agrees in number when one workflow leaves the token scope unset", () => {
    const r = analyzeWorkflows(wfBroad(1), "myorg")!;
    const f = r.findings.find((x) => x.id === "broad-permissions")!;
    expect(f.title).toContain("1 workflow leaves");
    expect(f.title).toContain("(inherits");
  });

  it("agrees in number when several do", () => {
    const r = analyzeWorkflows(wfBroad(3), "myorg")!;
    const f = r.findings.find((x) => x.id === "broad-permissions")!;
    expect(f.title).toContain("3 workflows leave");
    expect(f.title).toContain("(inherit ");
  });
});
