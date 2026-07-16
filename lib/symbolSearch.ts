// Fuzzy matching for the Source view's finder — jump to any file or function by
// typing. Pure + framework-free so it's unit-testable and cheap to run on every
// keystroke over the whole repo's file + symbol list.
//
// Symbols (functions) come from the code graph, so this is a real "jump to
// definition by name" — no language server, just our computed function list.

/** One searchable function, from the code graph. */
export interface SearchSymbol {
  name: string;
  path: string;
  /** 1-indexed definition line. */
  line: number;
}

export interface SearchResult {
  kind: "file" | "symbol";
  path: string;
  /** Symbols only — the definition line to jump to. */
  line?: number;
  /** The thing that matched (basename or function name). */
  primary: string;
  /** Context under it (the path). */
  secondary: string;
  score: number;
}

/** Score how well `query` matches `target`. Returns null when it isn't even a
 *  subsequence match. Higher is better; exact > prefix > word-boundary substring
 *  > substring > scattered subsequence, with shorter targets preferred. */
export function fuzzyScore(query: string, target: string): number | null {
  if (!query) return null;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (q === t) return 1000;

  const idx = t.indexOf(q);
  if (idx === 0) return 700 - t.length; // prefix
  if (idx > 0) {
    // Contiguous substring; boundary bonus when it starts a path/word segment.
    const boundary = /[/_\-.]/.test(t[idx - 1] ?? "") ? 100 : 0;
    return 400 + boundary - t.length - idx;
  }

  // Scattered subsequence: every query char in order, penalised by the gaps.
  let ti = 0;
  let gaps = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const found = t.indexOf(q[qi], ti);
    if (found === -1) return null;
    if (qi > 0 && found > ti) gaps += found - ti;
    ti = found + 1;
  }
  return 150 - gaps - t.length;
}

/** Rank files + symbols against a query. Files match on their basename (weighted
 *  up) or full path; symbols match on the function name. Returns the top `limit`,
 *  best first. Empty query → no results (caller shows the tree instead). */
export function searchSources(
  query: string,
  files: string[],
  symbols: SearchSymbol[],
  limit = 50,
): SearchResult[] {
  const q = query.trim();
  if (!q) return [];

  const results: SearchResult[] = [];

  for (const path of files) {
    const base = path.slice(path.lastIndexOf("/") + 1);
    const sBase = fuzzyScore(q, base);
    const sPath = fuzzyScore(q, path);
    // Prefer a basename hit (what people usually type) over a deep-path hit.
    const score = Math.max(
      sBase != null ? sBase + 50 : Number.NEGATIVE_INFINITY,
      sPath ?? Number.NEGATIVE_INFINITY,
    );
    if (score > Number.NEGATIVE_INFINITY) {
      results.push({ kind: "file", path, primary: base, secondary: path, score });
    }
  }

  for (const sym of symbols) {
    if (!sym.name) continue;
    const s = fuzzyScore(q, sym.name);
    if (s != null) {
      results.push({
        kind: "symbol",
        path: sym.path,
        line: sym.line,
        primary: sym.name,
        secondary: sym.path,
        score: s,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
