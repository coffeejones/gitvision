// Tests for the pure URL/ref helpers. isSafeGitRef guards a value that
// reaches a `git log <ref>` argv + Octokit calls, so its rejections matter
// for argument-injection safety.

import { describe, it, expect } from "vitest";
import { isSafeGitRef, parseDeepLinkSubdir } from "../githubUrl";

describe("isSafeGitRef", () => {
  it("accepts normal branch names, tags, and SHAs", () => {
    for (const ref of [
      "main",
      "develop",
      "feature/add-branch-picker",
      "release/2026.04",
      "v1.2.3",
      "renovate/lodash-4.x",
      "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0", // 40-char SHA
    ]) {
      expect(isSafeGitRef(ref)).toBe(true);
    }
  });

  it("rejects empty, overlong, and flag-shaped refs", () => {
    expect(isSafeGitRef("")).toBe(false);
    expect(isSafeGitRef("a".repeat(256))).toBe(false);
    expect(isSafeGitRef("-rf")).toBe(false); // leading dash → looks like a flag
    expect(isSafeGitRef("--output=/tmp/x")).toBe(false);
  });

  it("rejects whitespace, control chars, and the git-special set", () => {
    for (const ref of [
      "feature branch", // space
      "foo\tbar",
      "foo\nbar",
      "ref~1",
      "a^b",
      "a:b",
      "a?b",
      "a*b",
      "a[b",
      "a\\b",
    ]) {
      expect(isSafeGitRef(ref)).toBe(false);
    }
  });

  it("rejects malformed ref-name shapes", () => {
    expect(isSafeGitRef("a..b")).toBe(false);
    expect(isSafeGitRef("a//b")).toBe(false);
    expect(isSafeGitRef("/leading")).toBe(false);
    expect(isSafeGitRef("trailing/")).toBe(false);
    expect(isSafeGitRef("foo@{1}")).toBe(false);
    expect(isSafeGitRef("foo.lock")).toBe(false);
  });
});

describe("parseDeepLinkSubdir", () => {
  it("extracts the subdir after the branch segment in a /tree/ URL", () => {
    expect(
      parseDeepLinkSubdir("https://github.com/owner/repo/tree/main/src/cmd"),
    ).toBe("src/cmd");
  });

  it("returns null when there's no subdir or no /tree/ segment", () => {
    expect(parseDeepLinkSubdir("https://github.com/owner/repo")).toBeNull();
    expect(parseDeepLinkSubdir("https://github.com/owner/repo/tree/main")).toBeNull();
  });
});
