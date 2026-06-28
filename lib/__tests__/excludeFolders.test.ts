// Coverage for the exclude-folders primitives (lib/graph.ts): input
// validation/normalization and the repo-relative-path matcher.

import { describe, it, expect } from "vitest";
import { validateExcludeFolders, makeExcludeMatcher } from "../graph";

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

  it("an empty exclude list matches nothing", () => {
    const m = makeExcludeMatcher([]);
    expect(m("tests/x.ts")).toBe(false);
    expect(m("anything")).toBe(false);
  });
});
