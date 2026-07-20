// Which GitHub-linguist language names the code-analysis plugins can parse
// into functions/calls/complexity. Used for HONEST empty states: when a repo's
// primary language isn't in this set, the UI must say "X isn't parsed yet"
// instead of "0 functions — looks healthy" or "refresh to populate" (a refresh
// can never populate a language we don't parse; Rick hit exactly this on a
// pure-Dart repo).
//
// Keep in lockstep with the plugin registry (lib/codeAnalysis/plugins/*): when
// a language plugin ships, add its linguist name(s) here. Kotlin is
// deliberately absent — regexFallback reads its imports only, no functions.

const PARSED_LINGUIST_NAMES = new Set([
  "JavaScript",
  "TypeScript",
  "Python",
  "Go",
  "Java",
  "C#",
  "PHP",
  "Ruby",
]);

/** True when we parse this linguist language into functions/calls. */
export function isParsedLanguage(name: string): boolean {
  return PARSED_LINGUIST_NAMES.has(name);
}

/** The repo's dominant language by bytes, from the GitHub languages map
 *  (e.g. { Dart: 235907, Shell: 6341 }). Null when the map is empty. */
export function topLanguage(
  languages: Record<string, number> | null | undefined
): string | null {
  if (!languages) return null;
  let best: string | null = null;
  let bestBytes = 0;
  for (const [name, bytes] of Object.entries(languages)) {
    if (bytes > bestBytes) {
      best = name;
      bestBytes = bytes;
    }
  }
  return best;
}

/** The honest one-liner for a repo whose code we couldn't parse: names the
 *  dominant unsupported language when there is one. Null when the dominant
 *  language IS supported (caller should use a neutral "no parseable code"
 *  message instead). */
export function unsupportedLanguageNote(
  languages: Record<string, number> | null | undefined
): string | null {
  const top = topLanguage(languages);
  if (!top || isParsedLanguage(top)) return null;
  return top;
}
