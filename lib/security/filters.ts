// Confidence scoring + false-positive filters (v0.61 / B1).
//
// Pattern matches alone are noisy: AKIAIOSFODNN7EXAMPLE is in the AWS
// docs, fixture files seed real-looking keys, .env.example holds
// placeholders. We score each match 0-1 and surface only those above
// a threshold (default 0.5). Below that, the match is most likely a
// false positive and would erode user trust.
//
// Two axes of evidence:
//   1. The match text itself — does it look like a placeholder?
//   2. The file context — is this an example file, a test fixture,
//      a vendored docs page, etc.?
//
// Each filter returns a multiplier in [0,1]. The composite confidence
// is the product, so any one strong negative signal can push a match
// below threshold.

/** Bump-out lookups: if the matched text contains any of these tokens,
 *  it's almost certainly documentation or a placeholder. Lower-cased
 *  match for case-insensitive comparison. */
const PLACEHOLDER_TOKENS: readonly string[] = [
  "example",
  "placeholder",
  "your-key",
  "your_key",
  "your-token",
  "your_token",
  "yourkey",
  "yourtoken",
  "dummy",
  "sample",
  "fake",
  "redacted",
  "hidden",
  "secret-here",
  "secret_here",
];

/** Path segments that signal an example/test/docs context where seeded
 *  credentials are expected. Matched anywhere in the lower-cased path
 *  with surrounding slashes/dots so we don't accidentally hit a real
 *  source file like `examples-dashboard/src/index.ts`. */
const EXAMPLE_PATH_PATTERNS: readonly RegExp[] = [
  /\.example(\.[a-z0-9]+)?$/, // .env.example, config.example.json
  /\.sample(\.[a-z0-9]+)?$/, // .env.sample
  /\.template(\.[a-z0-9]+)?$/, // .env.template
  /\/(test|tests|__tests__|spec|specs|__specs__)\//,
  /\/(fixtures?|mocks?|examples?|samples?)\//,
  /\/docs?\//,
];

/** Match-text-based filter. Detects strings of all-X repeats, common
 *  placeholder words baked into the credential, etc. */
export function placeholderConfidence(match: string): number {
  const lower = match.toLowerCase();
  for (const tok of PLACEHOLDER_TOKENS) {
    if (lower.includes(tok)) return 0.05;
  }
  // Repeated character runs: AAAAAAAAAAA, 000000000000, xxxxxxxxxxxxxx
  if (/(.)\1{8,}/.test(match)) return 0.05;
  // Mostly-zero / mostly-X sequences (12+ of them in a row inside the
  // match's body, ignoring prefix).
  if (/[X0x]{12,}/.test(match)) return 0.1;
  return 1.0;
}

/** Path-context filter. Demotes matches in files whose mere existence
 *  signals "fixture-y": .env.example, /tests/, /docs/, etc. */
export function pathConfidence(filePath: string): number {
  const lower = filePath.toLowerCase();
  for (const re of EXAMPLE_PATH_PATTERNS) {
    if (re.test(lower)) return 0.3;
  }
  return 1.0;
}

/** Composite confidence: product of all individual filter outputs.
 *  Returns a value in [0,1]. Callers compare against a threshold
 *  (typically 0.5) to decide whether to surface the finding. */
export function computeConfidence(match: string, filePath: string): number {
  return placeholderConfidence(match) * pathConfidence(filePath);
}

/** Default minimum confidence for a finding to surface in the UI.
 *  Tuned conservatively — we'd rather miss an obscure obfuscation
 *  than fire on a docs example. Power users can override via the scan
 *  options if they want to see medium-confidence matches too. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.5;

/** Build a redacted preview of a matched secret. Shows enough to
 *  identify which key (when a user has multiple roted versions) but
 *  never the full credential. Format: first 6 + "..." + last 4, or
 *  the entire match if it's already 10 chars or shorter (rare; only
 *  PEM headers fall in that range and they're not credentials in
 *  themselves). */
export function redactPreview(match: string): string {
  if (match.length <= 10) return match;
  return `${match.slice(0, 6)}...${match.slice(-4)}`;
}
