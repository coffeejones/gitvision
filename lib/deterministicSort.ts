// The ONLY string ordering allowed anywhere the result feeds a computed
// artifact. `String.prototype.localeCompare` without an explicit locale is
// ICU/locale-dependent, so the same input can order differently across machines
// (notably a non-English OS locale) — which breaks the "same commit, byte-
// identical analysis" guarantee the product sells. Code-unit comparison is
// locale-independent and stable everywhere, and matches what the file walk in
// codeAnalysis/analyze.ts already does deliberately.
//
// A source-scan test (determinism.test.ts) enforces that no locale-free
// localeCompare creeps back in.

/** Stable, locale-independent string comparison by UTF-16 code unit. */
export function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
