// Boundary validation for the web /simulate route (Stage 2c): parseSimulateChanges
// accepts well-formed diffs and rejects junk / unsafe paths with a clear error.

import { describe, it, expect } from "vitest";
import { parseSimulateChanges, isSafeRelPath } from "../shadowGraph/validateChanges";

describe("isSafeRelPath", () => {
  it("accepts normal repo-relative paths", () => {
    expect(isSafeRelPath("src/auth/session.ts")).toBe(true);
    expect(isSafeRelPath("a.ts")).toBe(true);
  });

  it("rejects unsafe paths", () => {
    expect(isSafeRelPath("/etc/passwd")).toBe(false); // absolute
    expect(isSafeRelPath("../../etc/passwd")).toBe(false); // traversal
    expect(isSafeRelPath("a/../b")).toBe(false); // interior traversal
    expect(isSafeRelPath("a//b")).toBe(false); // empty segment
    expect(isSafeRelPath("./a")).toBe(false); // dot segment
    expect(isSafeRelPath("a\\b")).toBe(false); // backslash
    expect(isSafeRelPath("a\0b")).toBe(false); // NUL
    expect(isSafeRelPath("")).toBe(false); // empty
    expect(isSafeRelPath(42)).toBe(false); // non-string
    expect(isSafeRelPath("x".repeat(401))).toBe(false); // too long
  });
});

describe("parseSimulateChanges", () => {
  it("accepts a well-formed diff (edit + add + delete)", () => {
    const r = parseSimulateChanges({
      changes: [
        { path: "core.ts", newContent: "export const a = 1;" },
        { path: "new/file.ts", newContent: "export const b = 2;" },
        { path: "gone.ts", newContent: null },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.changes).toHaveLength(3);
      expect(r.changes[2]).toEqual({ path: "gone.ts", newContent: null });
    }
  });

  it("rejects a non-object body", () => {
    expect(parseSimulateChanges(null).ok).toBe(false);
    expect(parseSimulateChanges("nope").ok).toBe(false);
  });

  it("rejects a missing / non-array / empty changes list", () => {
    expect(parseSimulateChanges({}).ok).toBe(false);
    expect(parseSimulateChanges({ changes: "x" }).ok).toBe(false);
    expect(parseSimulateChanges({ changes: [] }).ok).toBe(false);
  });

  it("rejects more than the max changes", () => {
    const many = Array.from({ length: 3 }, (_, i) => ({
      path: `f${i}.ts`,
      newContent: "x",
    }));
    const r = parseSimulateChanges({ changes: many }, { maxChanges: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/too many/i);
  });

  it("rejects an unsafe path with a pointed error", () => {
    const r = parseSimulateChanges({
      changes: [{ path: "../../etc/passwd", newContent: "x" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/changes\[0\]\.path/);
  });

  it("rejects a non-string, non-null newContent", () => {
    const r = parseSimulateChanges({ changes: [{ path: "a.ts", newContent: 42 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/newContent/);
  });

  it("rejects duplicate paths", () => {
    const r = parseSimulateChanges({
      changes: [
        { path: "a.ts", newContent: "1" },
        { path: "a.ts", newContent: "2" },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/duplicate/i);
  });
});
