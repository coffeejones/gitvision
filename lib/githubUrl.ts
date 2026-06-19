// Pure URL-parsing helpers that are safe to import from both server and
// client components. Kept separate from lib/github.ts because the latter
// pulls in server-only deps (Octokit, tar) that webpack can't bundle for
// the browser.

/** Pull a subdir out of a GitHub deep-link like
 *    https://github.com/owner/repo/tree/branch/path/to/sub
 *  Branch names can contain slashes (e.g. release/2026.04), so the input
 *  is ambiguous without a server round-trip. We use a heuristic: the
 *  first segment after `/tree/` is treated as branch, everything after
 *  is the subdir. Returns null when the URL doesn't match the pattern.
 *  Always returns a posix-style path with no leading or trailing slash. */
export function parseDeepLinkSubdir(input: string): string | null {
  const m = input
    .trim()
    .match(/^https?:\/\/github\.com\/[^\/\s]+\/[^\/\s]+\/tree\/[^\/\s]+\/(.+?)\/?$/);
  if (!m) return null;
  const candidate = m[1].trim();
  if (!candidate) return null;
  return candidate;
}

/** Is `ref` a safe git ref (branch / tag / SHA) to hand to git + the GitHub
 *  API? The ref reaches a `git log <ref>` argv and Octokit calls, so we
 *  reject anything that could be read as a flag or break ref-name rules:
 *  control chars / spaces, the git-special set (~^:?*[\), a leading "-",
 *  ".." or "//" sequences, a leading/trailing slash, "@{", and a ".lock"
 *  suffix. Normal branch names (including slashes like "release/2026.04")
 *  and 40-char SHAs pass. Used to validate the branch picked in the
 *  pre-analysis config before it flows into the pipeline. */
export function isSafeGitRef(ref: string): boolean {
  if (!ref || ref.length > 255) return false;
  if (/[\x00-\x20\x7f ~^:?*\[\\]/.test(ref)) return false;
  if (ref.startsWith("-") || ref.startsWith("/") || ref.endsWith("/")) {
    return false;
  }
  if (ref.includes("..") || ref.includes("//") || ref.includes("@{")) {
    return false;
  }
  if (ref.endsWith(".lock")) return false;
  return true;
}
