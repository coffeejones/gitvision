// Coverage for the exclude-folders primitives (lib/graph.ts): input
// validation/normalization and the repo-relative-path matcher.

import { describe, it, expect } from "vitest";
import { validateExcludeFolders, makeExcludeMatcher } from "../graph";
import { computeHotspots, computeCoChange } from "../github";

describe("validateExcludeFolders", () => {
  it("returns [] for empty / absent / non-array input", () => {
    expect(validateExcludeFolders(undefined)).toEqual([]);
    expect(validateExcludeFolders(null)).toEqual([]);
    expect(validateExcludeFolders([])).toEqual([]);
    // @ts-expect-error — guarding the runtime path
    expect(validateExcludeFolders("tests")).toEqual([]);
  });

  it("trims, strips surrounding slashes, and drops blanks", () => {
    expect(validateExcludeFolders(["  tests  ", "/dist/", "", "  "])).toEqual([
      "tests",
      "dist",
    ]);
  });

  it("dedupes after normalization", () => {
    expect(validateExcludeFolders(["tests", "/tests/", "tests"])).toEqual([
      "tests",
    ]);
  });

  it("keeps multi-segment path prefixes", () => {
    expect(validateExcludeFolders(["packages/legacy", "examples"])).toEqual([
      "packages/legacy",
      "examples",
    ]);
  });

  it("rejects path traversal and empty segments", () => {
    expect(() => validateExcludeFolders(["../etc"])).toThrow();
    expect(() => validateExcludeFolders(["a//b"])).toThrow();
    expect(() => validateExcludeFolders(["foo/../bar"])).toThrow();
  });

  it("rejects backslash-style traversal (normalized before the guard)", () => {
    expect(() => validateExcludeFolders(["..\\etc"])).toThrow();
    expect(() => validateExcludeFolders(["foo\\..\\bar"])).toThrow();
    // a plain backslash path normalizes to a forward-slash prefix, not traversal
    expect(validateExcludeFolders(["packages\\legacy"])).toEqual([
      "packages/legacy",
    ]);
  });

  it("caps AFTER dedupe — duplicates don't consume cap budget", () => {
    const input = [
      ...Array.from({ length: 49 }, (_, i) => `dir${i}`),
      "dir0",
      "dir0",
      "dir0", // duplicates of an existing entry
      "fresh-50th",
      "fresh-overflow",
    ];
    const out = validateExcludeFolders(input);
    expect(out).toHaveLength(50);
    expect(out).toContain("fresh-50th"); // the 50th unique survived the dups
    expect(out).not.toContain("fresh-overflow");
  });

  it("rejects over-long entries", () => {
    expect(() => validateExcludeFolders(["a".repeat(201)])).toThrow();
  });

  it("caps the number of entries", () => {
    const many = Array.from({ length: 80 }, (_, i) => `dir${i}`);
    expect(validateExcludeFolders(many)).toHaveLength(50);
  });

  it("ignores non-string members", () => {
    // @ts-expect-error — guarding the runtime path
    expect(validateExcludeFolders(["tests", 42, null, "dist"])).toEqual([
      "tests",
      "dist",
    ]);
  });
});

describe("makeExcludeMatcher", () => {
  it("matches a bare name as a path segment anywhere", () => {
    const m = makeExcludeMatcher(["tests"]);
    expect(m("tests/foo.ts")).toBe(true);
    expect(m("src/tests/foo.ts")).toBe(true);
    expect(m("packages/core/tests/a.ts")).toBe(true);
    expect(m("src/app.ts")).toBe(false);
  });

  it("does not match a name against a file basename or partial segment", () => {
    const m = makeExcludeMatcher(["test"]);
    expect(m("src/test.ts")).toBe(false); // basename "test.ts" != "test"
    expect(m("src/testutils/x.ts")).toBe(false); // "testutils" != "test"
    expect(m("test/x.ts")).toBe(true); // real dir segment
  });

  it("matches a multi-segment entry as a path prefix only", () => {
    const m = makeExcludeMatcher(["packages/legacy"]);
    expect(m("packages/legacy")).toBe(true);
    expect(m("packages/legacy/src/a.ts")).toBe(true);
    expect(m("packages/legacy-utils/a.ts")).toBe(false); // not a path boundary
    expect(m("packages/core/a.ts")).toBe(false);
  });

  it("combines name and prefix rules", () => {
    const m = makeExcludeMatcher(["tests", "packages/legacy"]);
    expect(m("a/tests/b.ts")).toBe(true);
    expect(m("packages/legacy/x.ts")).toBe(true);
    expect(m("packages/core/src/x.ts")).toBe(false);
  });

  it("prefix match respects path boundaries (no sibling false-positives)", () => {
    const m = makeExcludeMatcher(["packages/legacy"]);
    expect(m("packages/legacy2/x.ts")).toBe(false); // sibling sharing the string
    expect(m("packages/legacyfoo/x.ts")).toBe(false);
    expect(m("src/packages/legacy/x.ts")).toBe(false); // prefix is anchored at root
  });

  it("a bare name also drops an extension-less file of that name (documented edge)", () => {
    const m = makeExcludeMatcher(["config"]);
    expect(m("config")).toBe(true);
    expect(m("src/config")).toBe(true);
    expect(m("src/config.ts")).toBe(false); // basename != "config"
  });

  it("filters manifest-shaped paths the way dep-health relies on", () => {
    const m = makeExcludeMatcher(["examples"]);
    expect(m("examples/package.json")).toBe(true);
    expect(m("packages/core/examples/package.json")).toBe(true);
    expect(m("package.json")).toBe(false);
    expect(m("packages/core/package.json")).toBe(false);
  });

  it("an empty exclude list matches nothing", () => {
    const m = makeExcludeMatcher([]);
    expect(m("tests/x.ts")).toBe(false);
    expect(m("anything")).toBe(false);
  });
});

// The git-history exclusion (lib/github.ts: filter perCommitFiles before
// computeHotspots/computeCoChange) is the one place exclusion is applied
// imperatively. Lock the contract: a pre-filtered perCommitFiles yields
// hotspots + co-change edges free of the excluded paths, while non-excluded
// files are unaffected.
describe("git-history exclusion → hotspots + co-change", () => {
  type PerCommit = Map<
    string,
    { files: string[]; authorLogin: string | null; date: string }
  >;

  function applyExclude(map: PerCommit, exclude: string[]): PerCommit {
    const isExcluded = makeExcludeMatcher(exclude);
    const out: PerCommit = new Map();
    for (const [sha, info] of map) {
      out.set(sha, { ...info, files: info.files.filter((f) => !isExcluded(f)) });
    }
    return out;
  }

  const raw: PerCommit = new Map([
    ["c1", { files: ["src/app.ts", "tests/app.test.ts"], authorLogin: "a", date: "2026-01-01" }],
    ["c2", { files: ["src/app.ts", "src/util.ts", "tests/util.test.ts"], authorLogin: "b", date: "2026-01-02" }],
    ["c3", { files: ["src/util.ts", "docs/readme.md"], authorLogin: "a", date: "2026-01-03" }],
  ]);

  it("drops excluded paths from hotspots, keeps real code", () => {
    const filtered = applyExclude(raw, ["tests", "docs"]);
    const hot = computeHotspots(filtered);
    const paths = hot.map((h) => h.path);
    expect(paths).toContain("src/app.ts");
    expect(paths).toContain("src/util.ts");
    expect(paths.some((p) => p.startsWith("tests/"))).toBe(false);
    expect(paths.some((p) => p.startsWith("docs/"))).toBe(false);
    // churn reflects only the kept commits touching the file
    expect(hot.find((h) => h.path === "src/app.ts")?.churn).toBe(2);
  });

  it("drops excluded paths from co-change edges", () => {
    const filtered = applyExclude(raw, ["tests", "docs"]);
    const allowed = new Set(computeHotspots(filtered).map((h) => h.path));
    const edges = computeCoChange(filtered, allowed, { minCount: 1 });
    for (const e of edges) {
      expect(e.from.startsWith("tests/")).toBe(false);
      expect(e.to.startsWith("tests/")).toBe(false);
      expect(e.from.startsWith("docs/")).toBe(false);
      expect(e.to.startsWith("docs/")).toBe(false);
    }
  });
});
