// Shared types for the secret-scanning module (v0.61 / B1).
//
// Pattern definitions and scan results — the building blocks of the
// "did I leave a key in my repo" check. Mirrors the plugin-style shape
// used elsewhere in the codebase (depsHealth ecosystems, codeAnalysis
// plugins): adding a new credential format = one entry in patterns.ts,
// no orchestrator changes.

export type SecretSeverity = "critical" | "high" | "medium";

/** A single secret-pattern definition. id is stable for analytics +
 *  evidence keying; the regex must use the `g` flag so matchAll() works.
 *  Confidence-adjustments live separately in filters.ts so detection
 *  stays declarative. */
export interface SecretPattern {
  id: string;
  /** Human-readable label shown in UI ("AWS Access Key ID"). */
  label: string;
  /** Global-flagged regex. Capture group 0 is the full match used for
   *  redacted preview generation. */
  regex: RegExp;
  severity: SecretSeverity;
}

/** A single match emitted by the scanner. Includes a redacted preview
 *  + 1-based line number so the UI can render "src/foo.ts:42 — AKIA...***"
 *  without leaking the full credential. */
export interface SecretFinding {
  filePath: string;
  line: number;
  patternId: string;
  patternLabel: string;
  /** First 6 chars of the match + "..." + last 4. Never the full key. */
  preview: string;
  severity: SecretSeverity;
  /** 0-1 confidence after applying false-positive filters. UI shows
   *  only findings with confidence >= a threshold (default 0.5). */
  confidence: number;
}

export interface SecretScanResult {
  /** All findings above the confidence threshold, ordered by severity
   *  desc then by file path asc for stable rendering. */
  findings: SecretFinding[];
  filesScanned: number;
  /** Truncation message if the scanner hit a file or line cap. */
  truncated?: string;
}
