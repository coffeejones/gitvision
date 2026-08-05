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

// --- The report ------------------------------------------------------------
//
// One list, one order, one place to add a gap. Two rules decide what belongs:
//
//   IT MUST FIRE. Half the candidates from the audit — the 25s timeout, the
//   5,000-file walker cap, the import-graph cap, the 50-manifest cap, the
//   10,000-commit cap — fired on 0 of 58 stored snapshots. The branches exist
//   below because they are cheap and the day one trips it matters, but they
//   emit NOTHING when they do not. A green "not truncated" row teaches the
//   reader to skip the whole block, which costs us the rows that do matter.
//
//   IT MUST VARY. A limit true of every repo is methodology and belongs in a
//   permanent caption next to the thing it bounds — no control-flow graph, top
//   120 hotspots, direct dependencies only. Mixing the two turns a finding into
//   boilerplate.

export type GapId =
  | "deps-no-ecosystem"
  | "code-not-parsed"
  | "code-skipped"
  | "walker-truncated"
  | "security-no-rules"
  | "scope-narrowed"
  | "pr-window"
  /** Emitted by the understand brief rather than the report: it is a floor on
   *  reach claims, and only meaningful next to one. */
  | "call-resolution";

/** Where the gap belongs. A gap that only affects Security has no business on
 *  a global panel — moving it there is how it gets ignored. */
export type GapSurface = "packages" | "security" | "code" | "prs" | "session";

/** blocking — a zero on this surface means "unchecked", not "clean".
 *  bounding — the numbers are real but they are a floor, not a total. */
export type GapKind = "blocking" | "bounding";

export interface CoverageGap {
  id: GapId;
  surface: GapSurface;
  kind: GapKind;
  /** One sentence with the real numbers already in it. */
  headline: string;
  /** The consequence, when it is not obvious from the headline. */
  detail?: string;
  /** The same figures unformatted, for callers that want to lay them out
   *  differently — the evidence pack, or an AI prompt that must not be handed
   *  prose to paraphrase. */
  numbers: Record<string, number | string>;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Every recorded blind spot in this snapshot, in a stable order.
 *
 *  A pure function: no I/O, no clock, no randomness — so the evidence pack and
 *  the UI cannot disagree, and two runs over one snapshot are byte-identical. */
export function buildCoverageReport(snap: AnalysisSnapshot): CoverageGap[] {
  const gaps: CoverageGap[] = [];

  // --- the analysis did not happen at all --------------------------------
  if (snap.codeGraphSkipReason) {
    gaps.push({
      id: "code-skipped",
      surface: "session",
      kind: "blocking",
      headline: "No code graph was produced for this snapshot.",
      detail: `${snap.codeGraphSkipReason} Blast radius, flows, test quality, drift and the code-path scanner are absent rather than empty.`,
      numbers: { reason: snap.codeGraphSkipReason },
    });
  } else if (snap.codeGraph && Object.keys(snap.codeGraph.byPlugin ?? {}).length === 0) {
    // A graph object with nothing in it. CodePanel and ArchitecturePanel gate
    // on the graph being ABSENT, not empty, so this renders as a wall of
    // zeroes: no functions, no complexity, no hotspots, no sinks.
    const lang = dominantLanguage(snap);
    gaps.push({
      id: "code-not-parsed",
      surface: "session",
      kind: "blocking",
      headline: lang
        ? `No file in this repo was opened by the code parser — it is mostly ${lang}, which has no plugin.`
        : "No file in this repo was opened by the code parser.",
      detail:
        "The zero functions, zero call edges, zero complexity hotspots and zero code-path findings here are the parser's silence, not the repo's.",
      numbers: lang ? { language: lang } : {},
    });
  }

  if (snap.codeGraph?.truncated) {
    // Never fired on the stored corpus. Kept because the day it does, every
    // fan-in count on the page is quietly short — and the dropped set depends
    // on filesystem order, so it is not even the same twice.
    gaps.push({
      id: "walker-truncated",
      surface: "code",
      kind: "bounding",
      headline: `The file walk stopped early: ${snap.codeGraph.truncated}`,
      detail:
        "Files past the cap were never opened, so calls into and out of them are missing from the graph. How many is not recorded.",
      numbers: {
        parsed: Object.keys(snap.codeGraph.fileComplexity ?? {}).length,
      },
    });
  }

  // --- dependencies ------------------------------------------------------
  const unread = describeUnreadEcosystem(snap);
  if (unread) {
    const where =
      unread.manifests.length > 0
        ? `declares its dependencies in ${unread.manifests[0]}${unread.ecosystem ? ` (${unread.ecosystem})` : ""}`
        : `is mostly ${unread.language}, and no manifest CodeTrawl reads was found`;
    gaps.push({
      id: "deps-no-ecosystem",
      surface: "packages",
      kind: "blocking",
      headline: `Dependencies were not checked — this repo ${where}.`,
      detail: `CodeTrawl reads ${READ_ECOSYSTEMS.join(", ")}. Nothing here was compared against a registry, against OSV, or against the known-incident list, so the Supply score is unmeasured rather than passing.`,
      numbers: {
        ecosystem: unread.ecosystem ?? "",
        manifest: unread.manifests[0] ?? "",
        language: unread.language ?? "",
      },
    });
  }

  // --- security ----------------------------------------------------------
  const unchecked = describeUncheckedLanguages(snap);
  if (unchecked) {
    gaps.push({
      id: "security-no-rules",
      surface: "security",
      kind: "blocking",
      headline: `${unchecked.plugins.join(" + ")} was parsed for structure, but ${unchecked.none ? "no" : "no additional"} dangerous-call rules exist for ${unchecked.plugins.length === 1 ? "it" : "them"}.`,
      detail: `${plural(unchecked.files, "file")} went unexamined for injection, deserialisation and path traversal. Rules exist for Python and JavaScript/TypeScript only.`,
      numbers: { files: unchecked.files, plugins: unchecked.plugins.join(","), noneChecked: unchecked.none ? 1 : 0 },
    });
  }

  // --- what the user themselves narrowed ---------------------------------
  if (snap.analyzedSubdir || (snap.analyzedExcludeFolders?.length ?? 0) > 0) {
    const parts: string[] = [];
    if (snap.analyzedSubdir) parts.push(`scoped to ${snap.analyzedSubdir}`);
    if (snap.analyzedExcludeFolders?.length) {
      parts.push(`excluding ${snap.analyzedExcludeFolders.join(", ")}`);
    }
    gaps.push({
      id: "scope-narrowed",
      surface: "session",
      kind: "bounding",
      headline: `This analysis was ${parts.join(", ")}.`,
      detail:
        "Files outside that scope were filtered out during extraction and never parsed, so \u201Cnothing calls this\u201D means nothing INSIDE the scope calls it.",
      numbers: {
        subdir: snap.analyzedSubdir ?? "",
        excluded: (snap.analyzedExcludeFolders ?? []).join(","),
      },
    });
  }

  // --- pull requests -----------------------------------------------------
  const prs = snap.pullRequests ?? [];
  if (prs.length >= PR_PAGE_CAP) {
    // The cap is what makes this a gap: at exactly the cap we know there are
    // more, and the window can be a rounding error against the repo's age.
    const dates = prs
      .map((p) => Date.parse(p.createdAt))
      .filter((n) => Number.isFinite(n));
    const days =
      dates.length > 1
        ? Math.round((Math.max(...dates) - Math.min(...dates)) / 86_400_000)
        : 0;
    gaps.push({
      id: "pr-window",
      surface: "prs",
      kind: "bounding",
      headline: `Review metrics cover the ${PR_PAGE_CAP} most recent pull requests${days > 0 ? ` — ${plural(days, "day")} of history` : ""}.`,
      detail:
        "Older pull requests were not fetched, so throughput and cycle time describe that window and not the project.",
      numbers: { count: prs.length, days },
    });
  }

  return gaps;
}

/** The page size the PR fetch stops at. At exactly this many we know the list
 *  was cut; below it we have everything. */
const PR_PAGE_CAP = 200;

/** The gaps that belong on one surface, in report order. */
export function gapsFor(
  snap: AnalysisSnapshot,
  surface: GapSurface,
): CoverageGap[] {
  return buildCoverageReport(snap).filter((g) => g.surface === surface);
}
