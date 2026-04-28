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
