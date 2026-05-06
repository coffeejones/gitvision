// Secret scanner orchestrator (v0.61 / B1).
//
// Pure function over a list of (filePath, content) pairs. Iterates the
// pattern registry, collects all regex matches per file, scores them
// via filters, and returns findings above the confidence threshold.
//
// Performance: each pattern is tried per file, but each is a single
// regex over the file content (.matchAll). On a 5000-file repo with
// 8 patterns, this is ~40000 regex matches — typically well under
// 100ms server-side. Caps below protect against pathological inputs
// (giant minified bundles, files with thousands of false matches).

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  computeConfidence,
  DEFAULT_CONFIDENCE_THRESHOLD,
  redactPreview,
} from "./filters";
import { PATTERNS } from "./patterns";
import type { SecretFinding, SecretScanResult } from "./types";

export interface ScanOptions {
  /** Minimum confidence (0-1) for a finding to surface. Default 0.5. */
  confidenceThreshold?: number;
  /** Cap on findings returned. Default 100 — enough to convey
   *  severity without flooding the UI on a poisoned-fixture repo. */
  maxFindings?: number;
  /** Per-file cap on matches the scanner will iterate before giving
   *  up on that file. Default 50 — protects against minified bundles
   *  with hundreds of dotted-segment matches. */
  perFileMatchCap?: number;
}

const DEFAULT_MAX_FINDINGS = 100;
const DEFAULT_PER_FILE_MATCH_CAP = 50;

/** A file ready for scanning. Path is repo-relative, content is the
 *  raw text. The scanner doesn't care about extensions — that
 *  filtering happens upstream in the analyze pipeline (which decides
 *  which extensions are interesting). */
export interface ScanFile {
  filePath: string;
  content: string;
}

export function scanForSecrets(
  files: ScanFile[],
  opts: ScanOptions = {}
): SecretScanResult {
  const threshold = opts.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const maxFindings = opts.maxFindings ?? DEFAULT_MAX_FINDINGS;
  const perFileCap = opts.perFileMatchCap ?? DEFAULT_PER_FILE_MATCH_CAP;

  const findings: SecretFinding[] = [];
  let truncatedReason: string | undefined;

  fileLoop: for (const file of files) {
    // Pre-compute line offsets for cheap line-number lookup. One pass
    // over the content; binary-search per match. Beats .split("\n")
    // followed by per-match counting.
    const lineStarts = computeLineStarts(file.content);
    let perFileMatches = 0;

    for (const pattern of PATTERNS) {
      // Reset lastIndex defensively — the regex objects in patterns.ts
      // are module-scoped so a global flag could carry state between
      // calls without this. Cheap insurance.
      pattern.regex.lastIndex = 0;

      for (const m of file.content.matchAll(pattern.regex)) {
        if (perFileMatches++ >= perFileCap) continue fileLoop;
        const matchText = m[0];
        const matchIndex = m.index ?? 0;
        const confidence = computeConfidence(matchText, file.filePath);
        if (confidence < threshold) continue;

        findings.push({
          filePath: file.filePath,
          line: lineFromIndex(matchIndex, lineStarts),
          patternId: pattern.id,
          patternLabel: pattern.label,
          preview: redactPreview(matchText),
          severity: pattern.severity,
          confidence,
        });

        if (findings.length >= maxFindings) {
          truncatedReason = `Capped at ${maxFindings} findings — repo may have more secrets to inspect.`;
          break fileLoop;
        }
      }
    }
  }

  // Sort: severity desc, then confidence desc, then path asc. Stable
  // ordering keeps the UI from shuffling findings between snapshots.
  const severityRank = { critical: 3, high: 2, medium: 1 } as const;
  findings.sort((a, b) => {
    if (severityRank[b.severity] !== severityRank[a.severity]) {
      return severityRank[b.severity] - severityRank[a.severity];
    }
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    if (a.filePath !== b.filePath) {
      return a.filePath.localeCompare(b.filePath);
    }
    return a.line - b.line;
  });

  return {
    findings,
    filesScanned: files.length,
    truncated: truncatedReason,
  };
}

// ---------------- Repo walker ----------------

/** Directories the walker skips entirely. Matches lib/codeAnalysis/analyze.ts
 *  conventions plus a few credential-irrelevant additions (cache dirs,
 *  python virtualenvs). Adding entries here also affects what
 *  analyze.ts effectively scans, since the dirs are common between
 *  both walks. */
const SECRET_SCAN_SKIP_DIRS: ReadonlySet<string> = new Set([
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

/** Extensions worth scanning for secrets that aren't already part of
 *  the code-analysis plugin set. Credential-rich formats: .env files,
 *  config files, infrastructure-as-code. We dedupe at the file level
 *  so callers can also pass code SourceFiles (.ts, .py, etc.) and the
 *  walker won't double-include them. */
const SECRET_RELEVANT_EXTS: ReadonlySet<string> = new Set([
  // Env / config — top priority for secret leaks
  "env",
  "yaml",
  "yml",
  "toml",
  "json",
  "ini",
  "conf",
  "config",
  "cfg",
  "properties",
  // Source code we already scan via code-analysis but include here so
  // the walker is self-sufficient (caller can choose to dedupe)
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "go",
  "java",
  "kt",
  "rb",
  "php",
  "cs",
  "rs",
  "sh",
  "bash",
  "zsh",
  // Markdown — accidentally pasting keys into READMEs is real
  "md",
  "mdx",
]);

/** Filenames matched by basename (case-insensitive) — files without
 *  extensions or with non-standard names that are still credential-y. */
const SECRET_RELEVANT_BASENAMES: ReadonlySet<string> = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.staging",
  ".env.test",
  "dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "credentials",
  "secrets",
]);

/** Per-file size cap. Bigger than 1 MB = unlikely to be hand-written
 *  source where secrets might hide; minified bundles and lockfiles
 *  fall in this bucket and would only generate noise. */
const MAX_FILE_BYTES = 1_000_000;

/** Default cap for how many files we scan in one call. Most repos
 *  stay well under this; exceeding it usually means generated assets
 *  slipped into the walk and should be excluded upstream. */
const DEFAULT_MAX_FILES = 5000;

export interface WalkOptions {
  maxFiles?: number;
}

/** Walk a local directory collecting files relevant for secret scan.
 *  Mirrors the SKIP_DIRS conventions from analyze.ts so the two walks
 *  see the same shape of repo. Returns ScanFile entries ready for
 *  scanForSecrets(). */
export async function walkRepoForSecrets(
  root: string,
  opts: WalkOptions = {}
): Promise<{ files: ScanFile[]; truncated: boolean }> {
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
  const out: ScanFile[] = [];
  let truncated = false;

  async function visit(dir: string): Promise<void> {
    if (out.length >= maxFiles) {
      truncated = true;
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= maxFiles) {
        truncated = true;
        return;
      }
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SECRET_SCAN_SKIP_DIRS.has(e.name)) continue;
        // Skip hidden dirs except .env-style files (handled at file level
        // below). Hidden dirs are typically tooling caches.
        if (e.name.startsWith(".") && !e.name.startsWith(".env")) continue;
        await visit(full);
      } else if (e.isFile()) {
        const lowerName = e.name.toLowerCase();
        const ext = path.extname(lowerName).slice(1);
        const baseNoExt = lowerName.startsWith(".")
          ? lowerName
          : path.basename(lowerName, ext ? `.${ext}` : "");
        const isRelevantExt = ext && SECRET_RELEVANT_EXTS.has(ext);
        const isRelevantName =
          SECRET_RELEVANT_BASENAMES.has(lowerName) ||
          SECRET_RELEVANT_BASENAMES.has(baseNoExt);
        // .env, .env.local, .env.production, etc. — `path.extname` on
        // ".env.local" returns ".local" which isn't in our ext set, so
        // we add a defensive prefix check.
        const isEnvLike = lowerName.startsWith(".env");
        if (!isRelevantExt && !isRelevantName && !isEnvLike) continue;
        try {
          const st = await fs.stat(full);
          if (st.size > MAX_FILE_BYTES) continue;
          const content = await fs.readFile(full, "utf-8");
          const rel = path.relative(root, full).split(path.sep).join("/");
          out.push({ filePath: rel, content });
        } catch {
          continue;
        }
      }
    }
  }

  await visit(root);
  return { files: out, truncated };
}

// ---------------- internals ----------------

/** Line-start offsets for a string. Index N gives the byte position
 *  where line N+1 begins (line numbers are 1-based for UI use). */
function computeLineStarts(content: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10 /* \n */) {
      starts.push(i + 1);
    }
  }
  return starts;
}

/** Binary-search lookup: 1-based line number of the byte offset.
 *  Mirrors how editors count lines so file:line references are
 *  intuitive. */
function lineFromIndex(index: number, lineStarts: number[]): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (lineStarts[mid] <= index) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo + 1;
}
