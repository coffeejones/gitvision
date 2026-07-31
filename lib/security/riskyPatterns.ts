// Risky-pattern scanner (v0.81+, signal #20).
//
// Conservative AST-style pattern matching for dynamic-code-execution
// primitives that are frequent vectors in supply-chain attacks and
// account compromises: eval(), new Function(), Python exec().
//
// The detection philosophy mirrors known-incident-match: we flag
// occurrences as "worth reviewing", never as "malicious". A legitimate
// codebase may have genuine reasons for eval (templating, JSON-RPC,
// REPLs) — we trust the human to decide once they see the evidence.
//
// What this scanner does NOT do:
//   - Track whether the eval argument is dynamic or constant. That
//     would require real AST analysis per language, which we have
//     for some plugins but not in a form available here. Result: we
//     match eval("1 + 1") too. The signal's wording acknowledges that
//     review is required.
//   - Skip eval inside strings or comments. Single-line comments
//     (// and #) are filtered with a basic check; multi-line block
//     block comments are accepted as a known FP source. Matches
//     inside single-line string literals are NOT — see
//     isInStringLiteral, added after every finding this scanner
//     produced on our own repo turned out to be one.
//   - Score severity. All findings are surfaced as informational
//     (questions bucket) — we lack the context to say "this eval
//     is bad" with confidence.
//
// Performance:
//   - One regex sweep per pattern per file (`.matchAll`).
//   - Filters minified files (line length > MAX_LINE_LEN) and
//     test / generated / bundled paths (shouldSkipPath, driven by
//     SKIP_SUBSTRINGS + SKIP_DIRS) before scanning. The header used
//     to name a PATH_SKIP_PATTERNS that has never existed.
//   - Per-file finding cap protects against pathological inputs.
//
// Reuses ScanFile from secretsScan — both scanners walk the same
// extracted tarball and consume the same shape.

import type { ScanFile } from "./secretsScan";

export interface RiskyPatternFinding {
  patternId: string;
  patternName: string;
  filePath: string;
  line: number;
  /** The exact source line, trimmed. Useful evidence for the UI;
   *  longer than ~120 chars gets truncated when rendered. */
  snippet: string;
}

export interface RiskyPatternScanResult {
  findings: RiskyPatternFinding[];
  /** Set when the scan hit caps and may have missed findings. */
  truncated?: string;
}

interface RiskyPattern {
  id: string;
  name: string;
  /** File extensions (without leading dot) where this pattern is
   *  meaningful. Avoids scanning Python eval against .ts files. */
  extensions: ReadonlySet<string>;
  /** Regex with `g` flag so .matchAll yields every occurrence.
   *  Negative-lookbehind `(?<![.\w$])` keeps method calls like
   *  `obj.eval(` and unrelated identifiers like `myEval(` from
   *  matching — only standalone calls produce hits. */
  regex: RegExp;
}

/** The pattern registry. Conservative by design — every entry
 *  matches a real construct that executes a string as code at
 *  runtime. Add new entries here with the same word-boundary
 *  discipline. */
const PATTERNS: ReadonlyArray<RiskyPattern> = [
  {
    id: "js-eval",
    name: "eval() call",
    extensions: new Set(["js", "ts", "jsx", "tsx", "mjs", "cjs", "mts", "cts"]),
    regex: /(?<![.\w$])eval\s*\(/g,
  },
  {
    id: "js-new-function",
    name: "new Function() constructor",
    extensions: new Set(["js", "ts", "jsx", "tsx", "mjs", "cjs", "mts", "cts"]),
    regex: /\bnew\s+Function\s*\(/g,
  },
  {
    id: "py-eval",
    name: "eval() call",
    extensions: new Set(["py"]),
    regex: /(?<![.\w$])eval\s*\(/g,
  },
  {
    id: "py-exec",
    name: "exec() call",
    extensions: new Set(["py"]),
    regex: /(?<![.\w$])exec\s*\(/g,
  },
];

/** Substring patterns matched anywhere in the path. Unambiguous
 *  enough that a substring hit is enough signal (".min.js" doesn't
 *  collide with anything legitimate). */
const SKIP_SUBSTRINGS: ReadonlyArray<string> = [
  ".test.",
  ".spec.",
  ".min.js",
  ".min.css",
];

/** Directory names that mark a file as test / generated / bundled.
 *  We match BOTH "X/..." (top-level) and ".../X/..." (nested) — the
 *  earlier "/X/"-only pattern missed top-level dist/, build/,
 *  node_modules/ etc. which is where they usually live. */
const SKIP_DIRS: ReadonlyArray<string> = [
  "test",
  "tests",
  "__tests__",
  "dist",
  "build",
  ".next",
  "node_modules",
  "vendor",
];

/** Files with any line longer than this are treated as minified
 *  bundles and skipped entirely. Real source rarely exceeds 500
 *  cols per line; minified bundles routinely do. */
const MAX_LINE_LEN = 500;

/** Hard cap on findings per file. Protects the UI from a file with
 *  hundreds of legit `eval` calls (an interpreter, a sandbox). */
const PER_FILE_FINDING_CAP = 20;

/** Global cap so the UI never gets flooded by a poisoned-fixture repo. */
const MAX_TOTAL_FINDINGS = 200;

function shouldSkipPath(path: string): boolean {
  const lower = path.toLowerCase();
  for (const sub of SKIP_SUBSTRINGS) {
    if (lower.includes(sub)) return true;
  }
  for (const dir of SKIP_DIRS) {
    if (lower.startsWith(`${dir}/`) || lower.includes(`/${dir}/`)) {
      return true;
    }
  }
  return false;
}

function isMinified(content: string): boolean {
  // Check first ~10 lines; bail early if any is too long.
  let inspected = 0;
  let start = 0;
  for (let i = 0; i < content.length && inspected < 10; i++) {
    if (content[i] === "\n") {
      if (i - start > MAX_LINE_LEN) return true;
      start = i + 1;
      inspected++;
    }
  }
  // File with no newlines or very few — if total length > MAX_LINE_LEN,
  // it's a single huge line (definitionally minified).
  return inspected === 0 && content.length > MAX_LINE_LEN;
}

function extOf(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  if (dot < 0) return "";
  return filePath.slice(dot + 1).toLowerCase();
}

function isCommented(line: string, matchStart: number): boolean {
  // Only catch the easy case: the match sits AFTER a `//` or `#`
  // on the same line. Multi-line block comments are not handled —
  // accepted as a known false-positive source, and documented in the
  // module header. String literals ARE handled, below.
  const before = line.slice(0, matchStart);
  return /\/\/|^#|\s#/.test(before);
}

/** Is the match inside a string literal on its own line?
 *
 *  This was listed as an accepted false-positive source, and it turned out to
 *  be the ONLY source on our own repository: all five findings were the word
 *  `eval(` inside a quoted string. Three were this file's own rule names —
 *  `name: "eval() call"` reported as an eval call — and two were a mock finding
 *  in the landing's showcase, i.e. the marketing illustration of a security
 *  result being reported as a security result.
 *
 *  Walks the line tracking quote state, so escapes and nested quote characters
 *  ("it's", 'say "hi"') do not confuse it. Single-line only, which is the same
 *  scope the comment check has: a match inside a multi-line template literal
 *  still gets through, and that stays documented rather than half-solved. */
function isInStringLiteral(line: string, matchStart: number): boolean {
  let quote: string | null = null;
  for (let i = 0; i < matchStart && i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\") i++; // skip the escaped character
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
    }
  }
  return quote !== null;
}

/** Compute 1-based line numbers cheaply by counting newlines up to
 *  the match offset. O(N) per match — fine for our scan sizes. */
function lineOf(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

/** Extract the line containing `offset` from `content`. Trimmed of
 *  leading/trailing whitespace — keeps the UI tidy. */
function lineAtOffset(content: string, offset: number): {
  text: string;
  startCol: number;
} {
  let lineStart = offset;
  while (lineStart > 0 && content[lineStart - 1] !== "\n") lineStart--;
  let lineEnd = offset;
  while (lineEnd < content.length && content[lineEnd] !== "\n") lineEnd++;
  return {
    text: content.slice(lineStart, lineEnd).trim(),
    startCol: offset - lineStart,
  };
}

export function scanForRiskyPatterns(
  files: ScanFile[],
): RiskyPatternScanResult {
  const findings: RiskyPatternFinding[] = [];
  let truncated: string | undefined;

  fileLoop: for (const file of files) {
    if (findings.length >= MAX_TOTAL_FINDINGS) {
      truncated = `Hit global cap of ${MAX_TOTAL_FINDINGS} findings; some files were not scanned.`;
      break;
    }
    if (shouldSkipPath(file.filePath)) continue;
    if (isMinified(file.content)) continue;

    const ext = extOf(file.filePath);
    let perFileCount = 0;

    for (const pattern of PATTERNS) {
      if (!pattern.extensions.has(ext)) continue;

      // .matchAll consumes the global regex iterator from the start.
      // Reset by re-creating it per call — regex objects with `g` carry
      // lastIndex state.
      for (const match of file.content.matchAll(pattern.regex)) {
        if (perFileCount >= PER_FILE_FINDING_CAP) break;
        if (findings.length >= MAX_TOTAL_FINDINGS) {
          truncated = `Hit global cap of ${MAX_TOTAL_FINDINGS} findings; some files were not scanned.`;
          break fileLoop;
        }
        const offset = match.index ?? 0;
        const { text, startCol } = lineAtOffset(file.content, offset);
        if (isCommented(text, startCol)) continue;
        if (isInStringLiteral(text, startCol)) continue;
        findings.push({
          patternId: pattern.id,
          patternName: pattern.name,
          filePath: file.filePath,
          line: lineOf(file.content, offset),
          // Truncate insanely long lines defensively.
          snippet: text.length > 200 ? text.slice(0, 200) + "…" : text,
        });
        perFileCount++;
      }
    }
  }

  return truncated ? { findings, truncated } : { findings };
}
