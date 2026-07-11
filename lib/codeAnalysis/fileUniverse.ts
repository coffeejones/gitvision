// The "parse universe" — the exact set of files the analyzer includes, and the
// filters that define it. Extracted from analyze.ts so ONE definition is shared
// by the full-analysis walker (walkAndRead) AND the Shadow-Graph patcher's
// add-file admission. If these ever diverge, a patched graph would include (or
// exclude) a file that a from-scratch analysis would not, silently breaking the
// golden-equivalence contract. Keeping them in one module makes that impossible.

/** Directories never descended into during the walk. */
export const SKIP_DIRS = new Set([
  "node_modules",
  "vendor",
  "dist",
  "build",
  "target",
  ".git",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".output",
  ".cache",
  "out",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".idea",
  ".vscode",
]);

/** Files larger than this are skipped (minified bundles, generated blobs). */
export const MAX_FILE_BYTES = 1_000_000;

/** Default per-repo file cap. Hitting it sets `truncated` (which disables the
 *  patcher's fast path — a truncated repo has a machine-dependent file SET). */
export const DEFAULT_MAX_FILES = 5000;

/** djb2 — a fast, stable, dependency-free 32-bit string hash. Used for per-file
 *  change detection and the universe digest, where collisions are negligible;
 *  NOT a security hash. Stable across platforms + runtimes. */
export function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Skip this directory during the walk? (name-based: skip-list + dotfiles) */
export function shouldSkipDir(name: string): boolean {
  return SKIP_DIRS.has(name) || name.startsWith(".");
}

/** Recognize files by path that virtually never represent real first-party
 *  source: vendored library copies under tests/assets, fixtures, vendor
 *  directories; explicitly-named .min.js / .bundle.js outputs. */
export function looksVendoredByPath(rel: string): boolean {
  if (/(^|\/)tests?\/(assets|fixtures)\//i.test(rel)) return true;
  if (/(^|\/)(vendor|vendored|third[_-]?party)\//i.test(rel)) return true;
  if (/\.min\.(js|mjs|cjs)$/i.test(rel)) return true;
  if (/[-.]bundle\.(js|mjs|cjs)$/i.test(rel)) return true;
  return false;
}

/** Heuristic for minified/bundled content. Real source files have lots of
 *  newlines; minified bundles cram code into one or two enormous lines. Samples
 *  only the first 10 KB so it stays cheap on big files. */
export function looksMinifiedByContent(content: string): boolean {
  if (content.length < 50_000) return false;
  const head = content.slice(0, 10_000);
  const newlines = (head.match(/\n/g) ?? []).length;
  if (newlines === 0) return true;
  const avgLineLen = head.length / (newlines + 1);
  return avgLineLen > 500;
}

/** The composite per-file admission decision. Given a file's repo-relative
 *  path, its byte size, and its content, decide whether the analyzer includes
 *  it. `hasPlugin` = an extension a plugin claims. This is the SINGLE gate both
 *  the walker and the patcher apply. Order matches walkAndRead exactly:
 *  extension → vendored-path → size → minified-content. */
export function isAnalyzableFile(args: {
  rel: string;
  ext: string;
  byteLength: number;
  content: string;
  hasPlugin: (ext: string) => boolean;
}): boolean {
  const { rel, ext, byteLength, content, hasPlugin } = args;
  if (!hasPlugin(ext)) return false;
  if (looksVendoredByPath(rel)) return false;
  if (byteLength > MAX_FILE_BYTES) return false;
  if (looksMinifiedByContent(content)) return false;
  return true;
}
