// What CodeTrawl could not check — computed, never asserted.
//
// The product collapses three different states into one green tile:
//
//   not present      the repo genuinely has none of this
//   present, unread  we have no reader for it
//   read and clean   we looked and found nothing
//
// Only the third is good news, and today the first two render identically to
// it. Two places where that is measurably wrong, and both are load-bearing:
//
//   PackagesPanel says "No package manifests detected in this repo" on 11 of
//   the 22 stored sessions — 7 of 10 distinct repos. It is not a detection
//   statement, it is a coverage one: gin declares its dependencies in go.mod,
//   petclinic in pom.xml, rspec in a .gemspec, serilog in six .csproj files.
//   All were seen by the walker. None were read.
//
//   Sink rules exist in exactly two plugins — javascript.ts and python.ts.
//   A Java, Go, C#, Ruby or PHP repo is parsed for structure and then examined
//   for injection, deserialisation and path traversal by nothing at all. Its
//   Security tab shows zero findings, which reads as zero problems.
//
// Everything here is derived from a persisted snapshot. No new analysis, no
// new fields, no AI. These functions return null when there is nothing honest
// to say — a caveat that renders on every repo trains the reader to skip it.

import type { AnalysisSnapshot } from "./types";
import { getDependencyHealths } from "./signals";
import { cmpStr } from "./deterministicSort";

/** Ecosystems we read, taken from the plugin registry rather than a list that
 *  can rot. lib/depsHealth/index.ts holds the authoritative array. */
export const READ_ECOSYSTEMS = ["npm", "Cargo", "PyPI"] as const;

/** Manifest filenames for ecosystems we KNOW exist and do NOT read.
 *
 *  This one has to be a literal: no plugin describes an ecosystem we have not
 *  implemented. Keep it to files whose presence is unambiguous evidence of a
 *  dependency system — naming the file is what makes the message checkable
 *  rather than a shrug. */
const UNREAD_MANIFESTS: { pattern: RegExp; ecosystem: string }[] = [
  { pattern: /(?:^|\/)go\.(mod|sum)$/, ecosystem: "Go modules" },
  { pattern: /(?:^|\/)pom\.xml$/, ecosystem: "Maven" },
  { pattern: /(?:^|\/)build\.gradle(\.kts)?$/, ecosystem: "Gradle" },
  { pattern: /(?:^|\/)Gemfile$/, ecosystem: "RubyGems" },
  { pattern: /(?:^|\/)[\w.-]+\.gemspec$/, ecosystem: "RubyGems" },
  { pattern: /(?:^|\/)[\w.-]+\.csproj$/, ecosystem: "NuGet" },
  { pattern: /(?:^|\/)composer\.json$/, ecosystem: "Composer" },
  { pattern: /(?:^|\/)pubspec\.yaml$/, ecosystem: "pub" },
];

export interface UnreadEcosystem {
  /** Ecosystem name, e.g. "Go modules". Null when we only know the language. */
  ecosystem: string | null;
  /** Manifest paths actually present in the snapshot, capped for display. */
  manifests: string[];
  /** Dominant language by bytes, as a fallback when no manifest surfaced. */
  language: string | null;
}

/** Every path the snapshot recorded, from whichever walk saw it.
 *
 *  Three sources because they cover different ground: hotspots are the top 120
 *  churned files (a manifest that changes often lands here), fileComplexity is
 *  everything the code parser opened, and the import graph's nodes are the
 *  broadest walk. A manifest is not parsed by any of them — it just has to have
 *  been SEEN, which is the point: we looked right at it. */
function knownPaths(snap: AnalysisSnapshot): string[] {
  const out: string[] = [];
  for (const h of snap.hotspots ?? []) out.push(h.path);
  for (const p of Object.keys(snap.codeGraph?.fileComplexity ?? {})) out.push(p);
  for (const n of snap.fileGraph?.nodes ?? []) out.push(n.path);
  return out;
}

function dominantLanguage(snap: AnalysisSnapshot): string | null {
  const entries = Object.entries(snap.languages ?? {});
  if (entries.length === 0) return null;
  let best: [string, number] | null = null;
  for (const e of entries) if (!best || e[1] > best[1]) best = e;
  return best?.[0] ?? null;
}

/** Why the dependency panel is empty — or null when it is not empty, or when
 *  we have no evidence the repo declares dependencies at all.
 *
 *  Returning null on "no evidence" is deliberate. A repo with genuinely no
 *  manifest and no recognisable language should say nothing rather than
 *  apologise; the honest message needs something concrete to point at. */
export function describeUnreadEcosystem(
  snap: AnalysisSnapshot,
): UnreadEcosystem | null {
  if (getDependencyHealths(snap).length > 0) return null;

  const seen = knownPaths(snap);
  const manifests: string[] = [];
  let ecosystem: string | null = null;
  for (const { pattern, ecosystem: name } of UNREAD_MANIFESTS) {
    for (const p of seen) {
      if (!pattern.test(p) || manifests.includes(p)) continue;
      manifests.push(p);
      ecosystem ??= name;
    }
  }

  // Shallowest first. serilog surfaces six .csproj files and
  // "src/Serilog/Serilog.csproj" tells the story better than a test project
  // three directories down.
  // cmpStr, not localeCompare: lib/__tests__/determinism.test.ts forbids
  // locale-dependent sorts in the engine, and it is right to — the same class
  // of bug as the date and number formatting fixed earlier today.
  manifests.sort(
    (a, b) => a.split("/").length - b.split("/").length || cmpStr(a, b),
  );

  const language = dominantLanguage(snap);
  // Nothing concrete to say. Better silent than vague.
  if (manifests.length === 0 && !language) return null;

  return { ecosystem, manifests: manifests.slice(0, 3), language };
}

/** Plugins that carry dangerous-call (sink) rules. Everything else is parsed
 *  for structure and then examined by nothing.
 *
 *  Hardcoded against the two plugin files that define sinks, and pinned by a
 *  test that greps them — so adding rules to a third plugin fails loudly here
 *  rather than leaving this list quietly wrong. */
export const SINK_RULE_PLUGINS = new Set(["javascript", "python"]);

export interface UncheckedLanguages {
  /** Plugin names that ran but have no sink rules, e.g. ["java", "go"]. */
  plugins: string[];
  /** Files those plugins parsed — the size of the unexamined surface. */
  files: number;
  /** True when NO plugin with sink rules ran at all, so a zero-finding
   *  Security tab means zero rules were applied. */
  none: boolean;
}

/** Which parsed languages had no security rules applied. Null when every
 *  plugin that ran carries rules, or when nothing was parsed at all (that is a
 *  different and larger gap, and saying both at once helps nobody). */
export function describeUncheckedLanguages(
  snap: AnalysisSnapshot,
): UncheckedLanguages | null {
  const byPlugin = snap.codeGraph?.byPlugin;
  if (!byPlugin) return null;

  const plugins: string[] = [];
  let files = 0;
  let checkedFiles = 0;
  for (const [name, stats] of Object.entries(byPlugin)) {
    // The regex fallback is HTML/CSS and Kotlin — it produces no call graph, so
    // it belongs to the "nothing was parsed" gap, not this one.
    if (name === "regex-fallback") continue;
    if (SINK_RULE_PLUGINS.has(name)) {
      checkedFiles += stats.files;
      continue;
    }
    plugins.push(name);
    files += stats.files;
  }

  if (plugins.length === 0) return null;
  return { plugins: plugins.sort(), files, none: checkedFiles === 0 };
}
