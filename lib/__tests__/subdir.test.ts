// Tests for the v0.24 subset-analysis primitives:
//   - validateSubdir: server-side input validation
//   - parseDeepLinkSubdir: client-side URL → subdir extraction for the
//     auto-fill flow on the landing page
//
// Both are pure string functions, no fixtures needed.

import { describe, it, expect } from "vitest";
import { validateSubdir } from "../graph";
import { parseDeepLinkSubdir } from "../githubUrl";

describe("validateSubdir", () => {
  it("returns null for empty / null / undefined input", () => {
    expect(validateSubdir(null)).toBeNull();
    expect(validateSubdir(undefined)).toBeNull();
    expect(validateSubdir("")).toBeNull();
    expect(validateSubdir("   ")).toBeNull();
  });

  it("returns the cleaned path for a valid subdir", () => {
    expect(validateSubdir("src/cmd")).toBe("src/cmd");
    expect(validateSubdir("packages/foo/lib")).toBe("packages/foo/lib");
    expect(validateSubdir("just-one")).toBe("just-one");
  });

  it("strips leading and trailing slashes", () => {
    expect(validateSubdir("/src/cmd")).toBe("src/cmd");
    expect(validateSubdir("src/cmd/")).toBe("src/cmd");
    expect(validateSubdir("///src/cmd///")).toBe("src/cmd");
  });

  it("trims whitespace before validation", () => {
    expect(validateSubdir("  src/cmd  ")).toBe("src/cmd");
  });

  it("rejects path traversal segments", () => {
    expect(() => validateSubdir("../etc")).toThrow(/path traversal/i);
    expect(() => validateSubdir("src/../etc")).toThrow(/path traversal/i);
    expect(() => validateSubdir("src/cmd/..")).toThrow(/path traversal/i);
  });

  it("rejects current-dir segments (.)", () => {
    expect(() => validateSubdir("src/./cmd")).toThrow(/path traversal/i);
    expect(() => validateSubdir(".")).toThrow(/path traversal/i);
  });

  it("rejects empty middle segments (foo//bar)", () => {
    expect(() => validateSubdir("src//cmd")).toThrow(/empty/i);
  });

  it("rejects over-long inputs (>200 chars)", () => {
    const long = "a/".repeat(120) + "z"; // 241 chars
    expect(() => validateSubdir(long)).toThrow(/too long/i);
  });

  it("accepts dotted dirs that aren't traversal (.github, .vscode)", () => {
    // Hidden-prefix dirs are legitimate paths; only "." and ".." segments
    // are traversal.
    expect(validateSubdir(".github/workflows")).toBe(".github/workflows");
    expect(validateSubdir("src/.config")).toBe("src/.config");
  });
});

describe("parseDeepLinkSubdir", () => {
  it("extracts a multi-segment path from a /tree/ URL", () => {
    expect(
      parseDeepLinkSubdir("https://github.com/golang/go/tree/master/src/cmd")
    ).toBe("src/cmd");
    expect(
      parseDeepLinkSubdir(
        "https://github.com/owner/repo/tree/main/packages/foo/lib"
      )
    ).toBe("packages/foo/lib");
  });

  it("handles a single-segment path", () => {
    expect(
      parseDeepLinkSubdir("https://github.com/owner/repo/tree/main/src")
    ).toBe("src");
  });

  it("strips a trailing slash from the URL", () => {
    expect(
      parseDeepLinkSubdir("https://github.com/owner/repo/tree/main/src/cmd/")
    ).toBe("src/cmd");
  });

  it("returns null for a plain repo URL (no /tree/ segment)", () => {
    expect(parseDeepLinkSubdir("https://github.com/owner/repo")).toBeNull();
    expect(parseDeepLinkSubdir("https://github.com/owner/repo/")).toBeNull();
  });

  it("returns null when /tree/ is followed only by a branch name", () => {
    // /tree/<branch> with no path → no subdir to extract
    expect(
      parseDeepLinkSubdir("https://github.com/owner/repo/tree/main")
    ).toBeNull();
    expect(
      parseDeepLinkSubdir("https://github.com/owner/repo/tree/main/")
    ).toBeNull();
  });

  it("returns null for non-github URLs and bare strings", () => {
    expect(
      parseDeepLinkSubdir("https://gitlab.com/owner/repo/tree/main/src")
    ).toBeNull();
    expect(parseDeepLinkSubdir("owner/repo/src/cmd")).toBeNull();
    expect(parseDeepLinkSubdir("not a URL")).toBeNull();
    expect(parseDeepLinkSubdir("")).toBeNull();
  });

  it("treats only the first /tree/ segment as branch (heuristic limitation)", () => {
    // Branch names CAN contain slashes (release/2026.04), in which case
    // we'd misclassify the second segment as part of the path. We
    // document this as known: the first /tree/<seg>/ takes precedence.
    expect(
      parseDeepLinkSubdir(
        "https://github.com/owner/repo/tree/release/2026.04/src"
      )
    ).toBe("2026.04/src"); // not "src" — heuristic limitation
  });

  it("trims whitespace around the input", () => {
    expect(
      parseDeepLinkSubdir("  https://github.com/owner/repo/tree/main/src  ")
    ).toBe("src");
  });
});
