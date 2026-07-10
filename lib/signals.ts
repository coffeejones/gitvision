// Rule-based health signal extraction.
//
// Each detector takes the AnalysisSnapshot and returns 0 or more HealthSignal
// objects categorized into `working`, `needsWork`, or `questions`. Detectors
// are intentionally deterministic, explainable, and independent — you can add
// or remove one without rewriting the others.
//
// The AI narrative layer (lib/healthAnalysis.ts) consumes this output; humans
// see both the AI prose AND the raw signals in the UI via an evidence toggle.

import { isBotAuthor } from "./botDetection";
import { detectKnownIncidents } from "./security/knownIncidents";
import type {
  AnalysisSnapshot,
  HealthSignal,
  HealthSignals,
  FileHotspot,
  FileGraph,
  DependencyHealth,
  OutdatedDep,
  VulnerableDep,
  DeprecatedDep,
} from "./types";

/** Aggregate dependency-health across all ecosystems present on a snapshot.
 *  Handles the pre-v0.9 singular shape AND the new array shape so old and
 *  new snapshots both produce correct signals without migration. */
function getDependencyHealths(snap: AnalysisSnapshot): DependencyHealth[] {
  if (snap.dependencyHealths && snap.dependencyHealths.length > 0) {
    return snap.dependencyHealths;
  }
  if (snap.dependencyHealth) return [snap.dependencyHealth];
  return [];
}

/** Flatten a per-issue array across ecosystems, tagging each with its source
 *  ecosystem so signal prose can say "22 npm, 3 cargo". */
interface TaggedDep<T> {
  ecosystem: string;
  dep: T;
}
function collectAcrossEcosystems<T>(
  healths: DependencyHealth[],
  picker: (h: DependencyHealth) => T[]
): TaggedDep<T>[] {
  const out: TaggedDep<T>[] = [];
  for (const h of healths) {
    for (const dep of picker(h)) {
      out.push({ ecosystem: h.ecosystem, dep });
    }
  }
  return out;
}

/** "22 npm, 3 cargo, 5 pypi" — for signal detail prose. */
function summarizeByEcosystem<T>(tagged: TaggedDep<T>[]): string {
  const counts = new Map<string, number>();
  for (const t of tagged) counts.set(t.ecosystem, (counts.get(t.ecosystem) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([eco, n]) => `${n} ${eco}`)
    .join(", ");
}

// Bot-author detection lives in lib/botDetection.ts so the GitHub App
// shares one canonical list with these signals — see PROGRESS.md and
// the eval/strategy/github-app-skeleton doc for the rationale.

// ------------------- File-classification helpers -------------------

const METADATA_BASENAMES = new Set<string>([
  "readme.md",
  "readme",
  "changelog.md",
  "changelog",
  "license",
  "license.md",
  "license.txt",
  "contributing.md",
  "code_of_conduct.md",
  "security.md",
  "package.json",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "cargo.toml",
  "cargo.lock",
  "go.mod",
  "go.sum",
  "gemfile",
  "gemfile.lock",
  "pipfile",
  "pipfile.lock",
  "requirements.txt",
  "poetry.lock",
  "pyproject.toml",
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  "dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
]);
const METADATA_PATTERNS: RegExp[] = [
  /\.prettierrc($|\.)/i,
  /\.eslintrc($|\.)/i,
  /\.stylelintrc($|\.)/i,
  /tsconfig(\.[^.]+)?\.json$/i,
  /jsconfig\.json$/i,
  /\.config\.(js|cjs|mjs|ts)$/i,
  /^\.github\//i,
];

export function isMetadataFile(path: string): boolean {
  const base = (path.split("/").pop() ?? "").toLowerCase();
  if (METADATA_BASENAMES.has(base)) return true;
  return METADATA_PATTERNS.some((re) => re.test(path));
}

const TEST_PATTERNS = [
  /\.test\.[jt]sx?$/i,
  /\.spec\.[jt]sx?$/i,
  /_test\.go$/i,
  /_spec\.rb$/i,
  /^test_.*\.py$/i,
  /(^|\/)tests?\//i,
  /(^|\/)__tests__\//i,
  /tests?\.[a-z]+$/i,
];

function isTestFile(path: string): boolean {
  return TEST_PATTERNS.some((re) => re.test(path));
}

const CODE_EXTS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "py", "rb", "go", "rs", "java", "kt", "scala", "swift",
  "c", "cc", "cpp", "h", "hpp", "cs", "php",
  "vue", "svelte", "astro",
]);

// Folders that are typically generated / are output of some upstream source.
// When cross-boundary coupling includes one of these, the pair is expected
// (source writes to output), not a red flag for leaking boundaries.
//
// Note: we deliberately DON'T include "lib" — it's source code in most
// projects (our own repo, express, every Node lib). Publishable-npm repos
// that use lib/ as dist would need a dedicated heuristic.
const OUTPUT_LIKE_FOLDERS = new Set<string>([
  "docs",
  "dist",
  "build",
  "out",
  "output",
  "public",
  "static",
  "_site",
  "site",
  "generated",
  "gen",
  "compiled",
  "bin",
  "data",
  "snapshots",
  "coverage",
  "assets",
  "www",
]);

function isSourceOutputPair(f1: string, f2: string): boolean {
  const a = f1.toLowerCase();
  const b = f2.toLowerCase();
  return OUTPUT_LIKE_FOLDERS.has(a) || OUTPUT_LIKE_FOLDERS.has(b);
}

export function isCodeFile(path: string): boolean {
  if (isMetadataFile(path)) return false;
  if (isTestFile(path)) return false;
  const ext = path.match(/\.([^./]+)$/)?.[1]?.toLowerCase();
  return !!ext && CODE_EXTS.has(ext);
}

function fileBasename(path: string): string {
  return path.split("/").pop() ?? path;
}

function folderOf(path: string): string {
  const parts = path.split("/");
  return parts.length > 1 ? parts[0] : "/";
}

// Three-layer test-coverage detection — most precise signal wins.
//
//   1. Sibling file: `foo.test.ts` next to `foo.ts`, `__tests__/foo.ts`, etc.
//   2. Import edge:  a test file that directly imports the hotspot
//   3. Name match:   a test file whose name contains the hotspot's basename
//
// Real-world test layouts (Next.js test/unit/..., React packages/*/src/__tests__/)
// don't fit sibling patterns, so we need broader signals to avoid false positives.
function hasTestCoverage(
  hotspot: FileHotspot,
  allKnownPaths: Set<string>,
  allTests: Set<string>,
  fileGraph: FileGraph | undefined
): boolean {
  // Layer 1: sibling patterns
  const base = fileBasename(hotspot.path);
  const nameNoExt = base.replace(/\.[^.]+$/, "");
  const ext = base.slice(nameNoExt.length);
  const dir = hotspot.path.slice(0, -base.length);

  const siblings = [
    `${dir}${nameNoExt}.test${ext}`,
    `${dir}${nameNoExt}.spec${ext}`,
    `${dir}__tests__/${base}`,
    `${dir}tests/${base}`,
    `${dir}test/${base}`,
    ext === ".go" ? `${dir}${nameNoExt}_test.go` : "",
    ext === ".py" ? `${dir}test_${nameNoExt}.py` : "",
  ].filter(Boolean);
  if (siblings.some((c) => allKnownPaths.has(c))) return true;

  // Layer 2: any test file directly imports this hotspot via fileGraph
  if (fileGraph) {
    for (const edge of fileGraph.edges) {
      if (edge.to === hotspot.path && isTestFile(edge.from)) return true;
    }
  }

  // Layer 3: a test file's basename contains the hotspot's basename.
  // Only useful when the name is distinctive (≥ 4 chars) to avoid matching
  // generic names like "index" or "utils" everywhere.
  const nameLower = nameNoExt.toLowerCase();
  if (nameLower.length >= 4 && nameLower !== "index" && nameLower !== "utils") {
    for (const test of allTests) {
      const testBase = (test.split("/").pop() ?? "").toLowerCase();
      if (testBase.includes(nameLower)) return true;
    }
  }

  return false;
}

// Median helper for cycle-time calculations.
function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// Humanize a day-count for prose. A raw `toFixed(1)` rendered sub-day
// durations as "0.0 days" (fast repos merge in hours) — nonsense. Drop to
// hours under a day, keep one decimal up to ~10 days, whole days beyond.
// Returns the unit too, so callers must NOT append "days".
function humanizeDuration(days: number): string {
  const hours = days * 24;
  if (hours < 1) return "under an hour";
  if (days < 1) {
    const h = Math.round(hours);
    return `about ${h} hour${h === 1 ? "" : "s"}`;
  }
  if (days < 10) {
    const r = Math.round(days * 10) / 10;
    return `${r} day${r === 1 ? "" : "s"}`;
  }
  return `${Math.round(days)} days`;
}

// ------------------- Detectors -------------------

// 1. PR throughput — healthy merge vs. open ratio (working) OR backlog (needsWork).
// Excludes bot-authored PRs because they distort the "is review keeping up?" signal:
// dependabot can file 50 PRs in a day and auto-merge them all, making throughput
// look healthy even when human PRs pile up.
function detectPrThroughput(
  snap: AnalysisSnapshot
): { working: HealthSignal[]; needsWork: HealthSignal[] } {
  const working: HealthSignal[] = [];
  const needsWork: HealthSignal[] = [];
  if (!snap.pullRequests || snap.pullRequests.length === 0) {
    return { working, needsWork };
  }
  const humanPrs = snap.pullRequests.filter((p) => !isBotAuthor(p.authorLogin));
  const merged = humanPrs.filter((p) => p.merged).length;
  const open = humanPrs.filter((p) => p.state === "open").length;
  const total = merged + open;
  if (total < 5) return { working, needsWork };

  if (merged >= open && merged >= 5) {
    working.push({
      id: "healthy-pr-throughput",
      title: "Healthy review throughput",
      detail: `${merged} merged vs ${open} open among human-authored PRs — review keeps pace with intake.`,
      evidence: { numbers: { merged, open } },
    });
  } else if (open > merged * 1.5) {
    const ratio = merged > 0 ? (open / merged).toFixed(1) : "∞";
    needsWork.push({
      id: "pr-backlog",
      title: "PR backlog growing",
      detail: `${open} human-authored PRs open against ${merged} recently merged (${ratio}× intake) — review is the bottleneck.`,
      evidence: { numbers: { open, merged } },
      severity: open > merged * 3 ? "high" : "medium",
    });
  }
  return { working, needsWork };
}

// 2. PR cycle time — fast merges (working) vs. slow reviews (needsWork).
// Bot-authored PRs (dependabot, renovate, release-bot) typically merge in
// minutes and drag the median artificially low. Filter them out to get a
// cycle-time signal that reflects human review workflow.
function detectPrCycleTime(
  snap: AnalysisSnapshot
): { working: HealthSignal[]; needsWork: HealthSignal[] } {
  const working: HealthSignal[] = [];
  const needsWork: HealthSignal[] = [];
  const mergedPRs = (snap.pullRequests ?? []).filter(
    (p) =>
      p.merged &&
      p.createdAt &&
      p.mergedAt &&
      !isBotAuthor(p.authorLogin)
  );
  if (mergedPRs.length < 5) return { working, needsWork };

  const durationsMs = mergedPRs.map(
    (p) =>
      new Date(p.mergedAt as string).getTime() -
      new Date(p.createdAt).getTime()
  );
  const medianDays = median(durationsMs) / (1000 * 60 * 60 * 24);

  if (medianDays <= 3) {
    working.push({
      id: "fast-pr-cycle",
      title: "Fast PR cycle",
      detail: `Median time-to-merge is ${humanizeDuration(medianDays)} across ${mergedPRs.length} recent human-authored merges — team ships quickly.`,
      evidence: { numbers: { medianDays: +medianDays.toFixed(1), sampled: mergedPRs.length } },
    });
  } else if (medianDays >= 14) {
    needsWork.push({
      id: "slow-pr-cycle",
      title: "Slow PR reviews",
      detail: `Human-authored PRs take a median of ${humanizeDuration(medianDays)} to merge — review friction is real.`,
      evidence: { numbers: { medianDays: +medianDays.toFixed(1), sampled: mergedPRs.length } },
      severity: medianDays > 30 ? "high" : "medium",
    });
  }
  return { working, needsWork };
}

// 3. Knowledge distribution — broad diversity (working) vs. concentration (needsWork).
// Accepts `isSoloProject` so we don't double-dip: on a solo repo the whole repo
// is single-owner by definition, and the solo-project question already covers it.
function detectKnowledgeDistribution(
  snap: AnalysisSnapshot,
  isSoloProject: boolean
): { working: HealthSignal[]; needsWork: HealthSignal[] } {
  const working: HealthSignal[] = [];
  const needsWork: HealthSignal[] = [];

  const byFolder = new Map<string, Set<string>>();
  const churnByFolder = new Map<string, number>();
  for (const h of snap.hotspots) {
    const folder = folderOf(h.path);
    const authors = byFolder.get(folder) ?? new Set<string>();
    // Exclude bots (dependabot, pre-commit-ci, …) — they shouldn't inflate a
    // folder's owner count (masking bus-factor) or fake "broad ownership".
    (h.authorLogins ?? []).forEach((a) => {
      if (!isBotAuthor(a)) authors.add(a);
    });
    byFolder.set(folder, authors);
    churnByFolder.set(folder, (churnByFolder.get(folder) ?? 0) + h.churn);
  }
  if (byFolder.size < 2) return { working, needsWork };

  // Only flag folders with meaningful activity (≥ 5 churn).
  const active = [...byFolder.entries()]
    .filter(([f]) => (churnByFolder.get(f) ?? 0) >= 5)
    .filter(([f]) => f !== "/"); // root-level files are usually config/docs

  const singleOwner = active
    .filter(([, a]) => a.size === 1)
    .map(([f]) => f);
  const diverseOwned = active.filter(([, a]) => a.size >= 3).map(([f]) => f);

  // Suppress concentration signal on solo projects — it's just restating
  // solo-project status. Solo-project detector in questions covers it.
  if (singleOwner.length >= 1 && !isSoloProject) {
    needsWork.push({
      id: "bus-factor-risk",
      title: "Knowledge concentration",
      detail: `${singleOwner.length} active folder${singleOwner.length === 1 ? "" : "s"} maintained by a single contributor — high bus factor risk.`,
      evidence: { paths: singleOwner.slice(0, 4) },
      severity: singleOwner.length >= 3 ? "high" : "medium",
    });
  }
  if (diverseOwned.length >= 3) {
    working.push({
      id: "broad-ownership",
      title: "Broad ownership",
      detail: `${diverseOwned.length} folders have 3+ recent contributors — resilient against any one person leaving.`,
      evidence: { paths: diverseOwned.slice(0, 4) },
    });
  }
  return { working, needsWork };
}

// 4. Untested hotspots — only fires when test presence is genuinely thin.
// Global gate: if the repo has many tests globally (≥ 30, or ≥ 25% of code
// files), the test layout just isn't sibling/import-discoverable and we'd
// rather stay silent than cry wolf.
function detectUntestedHotspots(snap: AnalysisSnapshot): HealthSignal[] {
  // A subdir-scoped analysis sees only part of the repo — the test suite
  // conventionally lives at the repo root, OUTSIDE the analyzed subdir — so a
  // low in-scope test count is NOT evidence of "no tests". Don't make a
  // repo-wide untested claim from a partial view. (This is what wrongly
  // Failed pallets/flask when scoped to src/flask, with tests/ excluded.)
  if (snap.analyzedSubdir) return [];

  const { allPaths, allTests, codeFileCount } = collectPathIndices(snap);

  const codeHotspots = snap.hotspots
    .slice(0, 25)
    .filter((h) => isCodeFile(h.path));
  if (codeHotspots.length < 5) return [];

  // Global sanity gate — plenty of tests exist, we just can't connect them.
  if (allTests.size >= 30) return [];
  if (codeFileCount > 0 && allTests.size / codeFileCount >= 0.25) return [];

  const untested = codeHotspots.filter(
    (h) => !hasTestCoverage(h, allPaths, allTests, snap.fileGraph)
  );
  const pct = Math.round((untested.length / codeHotspots.length) * 100);
  if (pct < 50) return [];

  return [
    {
      id: "untested-hotspots",
      title: "Hot files lack visible tests",
      detail: `${pct}% of the top-churn code files have no discoverable test — regressions in these areas are easy to miss.`,
      evidence: {
        paths: untested.slice(0, 3).map((h) => h.path),
        numbers: { pctUntested: pct, sampled: codeHotspots.length },
      },
      severity: pct > 80 ? "high" : "medium",
    },
  ];
}

// Helper — build path indices once so detectors don't redo the work.
function collectPathIndices(snap: AnalysisSnapshot): {
  allPaths: Set<string>;
  allTests: Set<string>;
  codeFileCount: number;
} {
  const allPaths = new Set<string>();
  snap.hotspots.forEach((h) => allPaths.add(h.path));
  snap.fileGraph?.nodes.forEach((n) => allPaths.add(n.path));
  const allTests = new Set<string>();
  let codeFileCount = 0;
  for (const p of allPaths) {
    if (isTestFile(p)) allTests.add(p);
    else if (isCodeFile(p)) codeFileCount++;
  }
  return { allPaths, allTests, codeFileCount };
}

// 5. Cross-boundary coupling — files from different top-level folders that
// change together frequently. Signal for leaky module boundaries.
//
// Domain-aware: pairs involving a typical output/artifact folder (docs/,
// dist/, public/, data/, etc.) are EXPECTED to co-change with their source,
// so we exclude them from the flag. A scraper writing to docs/ isn't a
// coupling problem — it's the whole point.
function detectCrossBoundaryCoupling(snap: AnalysisSnapshot): HealthSignal[] {
  const allCross = (snap.coChange ?? []).filter((e) => {
    const f1 = folderOf(e.from);
    const f2 = folderOf(e.to);
    return f1 !== f2 && f1 !== "/" && f2 !== "/" && e.count >= 3;
  });

  // Split into "real" coupling vs. source-output pairs (expected behavior).
  const real = allCross.filter(
    (e) => !isSourceOutputPair(folderOf(e.from), folderOf(e.to))
  );

  if (real.length < 3) return [];
  const top = real.slice(0, 2);
  return [
    {
      id: "cross-boundary-coupling",
      title: "Tightly-coupled modules",
      detail: `${real.length} file pairs across different top-level folders change together frequently — module boundaries may be leaking.`,
      evidence: {
        paths: top.flatMap((e) => [e.from, e.to]),
        numbers: { pairs: real.length },
      },
      severity: real.length >= 10 ? "high" : "medium",
    },
  ];
}

// Risky dynamic-execution patterns (v0.81+ signal #20). Reports the
// COUNT of eval / new Function / exec occurrences detected by the
// scanForRiskyPatterns walker during analysis. We don't claim any
// of them is malicious — we surface the count so a security review
// can decide.
//
// Always bucketed as "questions" (no severity). The wording is
// deliberately neutral: "N occurrences worth reviewing". A REPL or
// template library will have many; an auth-handler shouldn't have
// any.
//
// Below the surface threshold (MIN_FINDINGS), we emit no signal —
// scattered eval/Function in build scripts or rare codegen edges
// would generate noise without value.
function detectRiskyPatterns(snap: AnalysisSnapshot): HealthSignal[] {
  const result = snap.riskyPatternFindings;
  if (!result || result.findings.length === 0) return [];

  const MIN_FINDINGS = 1; // Surface even single occurrences — they're
  // rare enough on real codebases (after our path/minified filters)
  // that one match is interesting.
  if (result.findings.length < MIN_FINDINGS) return [];

  // Group by file for a compact evidence rendering: "src/eval.ts (3)".
  // Caps at 5 file groups in the paths array — full count goes in
  // evidence.numbers.
  const byFile = new Map<string, number>();
  for (const f of result.findings) {
    byFile.set(f.filePath, (byFile.get(f.filePath) ?? 0) + 1);
  }
  const fileGroups = [...byFile.entries()].sort((a, b) => b[1] - a[1]);
  const topGroups = fileGroups.slice(0, 5);
  const evidencePaths = topGroups.map(([path, count]) =>
    count > 1 ? `${path} (×${count})` : path,
  );

  return [
    {
      id: "risky-eval-patterns",
      title: "Dynamic-execution patterns worth reviewing",
      detail: `${result.findings.length} occurrence${result.findings.length === 1 ? "" : "s"} of eval / new Function / exec across ${byFile.size} file${byFile.size === 1 ? "" : "s"}. These execute strings as code at runtime — verify the input is trusted.`,
      evidence: {
        paths: evidencePaths,
        numbers: {
          occurrences: result.findings.length,
          files: byFile.size,
        },
      },
      // No severity — "questions" bucket. The detector can't tell
      // legitimate codegen from sneaky payload without context.
    },
  ];
}

// Deep import chains — walks the fileGraph for the longest path from
// any entry-point (a node nothing imports) down through its
// transitive imports. Returns a signal naming the depth + one example
// chain when it exceeds a healthy threshold.
//
// Why: deep import trees mean changes near the top ripple wider than
// they would in a shallow tree. A 12-level chain implies any refactor
// at the top is going to touch a lot of downstream consumers.
//
// Implementation notes:
//   - Reuses node.layer, which is already computed during fileGraph
//     construction (BFS depth from roots, where "roots" are nodes
//     nothing imports — entry points like pages, mains, exported
//     barrel files). No re-traversal needed for the max-depth
//     calculation.
//   - Chain reconstruction is one-pass backwards from the deepest
//     node, choosing each step's predecessor as a node at layer
//     (current.layer - 1) that has an edge pointing to current.
//     One predecessor is enough — we don't enumerate every chain,
//     just show the visitor one example of how deep the tree goes.
//   - Severity ladders with depth:
//       < 6        no signal (typical for most apps)
//       6-8        informational (no severity → questions bucket)
//       9-11       medium severity (needsWork bucket)
//       12+        high severity (needsWork bucket)
//
// (v0.81+, signal #18.)
function detectDeepDependencyChains(snap: AnalysisSnapshot): HealthSignal[] {
  const fileGraph = snap.fileGraph;
  if (!fileGraph || fileGraph.nodes.length === 0) return [];

  // Find the deepest node and its layer.
  let maxLayer = 0;
  let deepestNode: (typeof fileGraph.nodes)[number] | null = null;
  for (const n of fileGraph.nodes) {
    if (n.layer > maxLayer) {
      maxLayer = n.layer;
      deepestNode = n;
    }
  }

  // Shallow trees get no signal — most apps land here.
  if (maxLayer < 6 || !deepestNode) return [];

  // Reconstruct one example chain by tracing edges backwards from the
  // deepest node. At each step, look for a predecessor node whose layer
  // is exactly (current.layer - 1). This guarantees we walk one valid
  // BFS path back to a root; bail if no such predecessor exists (the
  // graph would be malformed, but defensive code never hurts).
  const nodeMap = new Map(fileGraph.nodes.map((n) => [n.path, n]));
  const predecessorsByNode = new Map<string, string[]>();
  for (const e of fileGraph.edges) {
    const list = predecessorsByNode.get(e.to) ?? [];
    list.push(e.from);
    predecessorsByNode.set(e.to, list);
  }

  const chain: string[] = [deepestNode.path];
  let current = deepestNode;
  while (current.layer > 0) {
    const preds = predecessorsByNode.get(current.path) ?? [];
    let parent: (typeof fileGraph.nodes)[number] | null = null;
    for (const p of preds) {
      const n = nodeMap.get(p);
      if (n && n.layer === current.layer - 1) {
        parent = n;
        break;
      }
    }
    if (!parent) break;
    chain.unshift(parent.path);
    current = parent;
  }

  // Severity ladders with depth — the deeper, the wider the ripple.
  // undefined severity = informational (caller buckets into questions).
  let severity: "low" | "medium" | "high" | undefined;
  if (maxLayer >= 12) severity = "high";
  else if (maxLayer >= 9) severity = "medium";
  else severity = undefined; // 6-8 = noteworthy but not a problem

  return [
    {
      id: "deep-dependency-chains",
      title:
        maxLayer >= 12
          ? "Very deep import chains"
          : "Deep import chains",
      detail: `The deepest import chain runs ${maxLayer} levels — a change near the top ripples down through every step.`,
      evidence: {
        paths: chain,
        numbers: { maxDepth: maxLayer },
      },
      severity,
    },
  ];
}

// 6. Metadata dominance — is most of the visible "activity" just releases?
function detectMetadataDominance(snap: AnalysisSnapshot): HealthSignal[] {
  const top = snap.hotspots.slice(0, 15);
  if (top.length < 10) return [];
  const metaCount = top.filter((h) => isMetadataFile(h.path)).length;
  const pct = Math.round((metaCount / top.length) * 100);
  if (pct < 60) return [];
  return [
    {
      id: "metadata-dominance",
      title: "Mostly metadata churn",
      detail: `${pct}% of the top churn is in lockfiles, configs, and release artifacts. Real feature development may be happening elsewhere — or the project may be in maintenance mode.`,
      evidence: {
        numbers: { metadataPct: pct, sampled: top.length },
      },
    },
  ];
}

// 7. Recent activity — very active (working) vs. stale (needsWork)
function detectActivityRecency(
  snap: AnalysisSnapshot
): { working: HealthSignal[]; needsWork: HealthSignal[] } {
  const working: HealthSignal[] = [];
  const needsWork: HealthSignal[] = [];
  const latestIso =
    snap.historySource?.latest ??
    snap.recentCommits[0]?.date ??
    snap.repo.pushedAt;
  if (!latestIso) return { working, needsWork };
  const days = (Date.now() - new Date(latestIso).getTime()) / (1000 * 60 * 60 * 24);
  if (days < 0) return { working, needsWork };

  if (days < 7) {
    working.push({
      id: "very-active",
      title: "Actively developed",
      detail: `Last commit was ${Math.round(days)} day${Math.round(days) === 1 ? "" : "s"} ago.`,
      evidence: { numbers: { daysSinceLastCommit: Math.round(days) } },
    });
  } else if (days > 90) {
    needsWork.push({
      id: "stale",
      title: "Not recently active",
      detail: `Last commit was ${Math.round(days)} days ago — the project may be paused, finished, or abandoned.`,
      evidence: { numbers: { daysSinceLastCommit: Math.round(days) } },
      severity: days > 365 ? "high" : "medium",
    });
  }
  return { working, needsWork };
}

// 8. Solo contributor check (question — not intrinsically bad)
function detectSoloProject(snap: AnalysisSnapshot): HealthSignal[] {
  const authors = new Set<string>();
  snap.hotspots.forEach((h) =>
    (h.authorLogins ?? []).forEach((a) => {
      if (!isBotAuthor(a)) authors.add(a);
    })
  );
  if (authors.size !== 1) return [];
  if (snap.recentCommits.length < 5) return [];
  const [onlyAuthor] = [...authors];
  return [
    {
      id: "solo-project",
      title: "Solo project",
      detail: `All visible activity is by @${onlyAuthor}. If this is an intentional personal project, great — otherwise the bus factor is one.`,
      evidence: { note: onlyAuthor },
    },
  ];
}

// 9. Missing open-source hygiene (license/README) — question.
// README check uses the snapshot's `hasReadme` flag, populated from GitHub's
// dedicated /readme endpoint during analysis. Path-scanning was unreliable
// because README files often don't appear in hotspots or the file-graph.
// On pre-v0.6 snapshots without the flag, skip the README check entirely
// rather than falsely accuse mature repos.
function detectMissingHygiene(snap: AnalysisSnapshot): HealthSignal[] {
  const missing: string[] = [];
  if (!snap.repo.license) missing.push("LICENSE");
  if (snap.hasReadme === false) missing.push("README");
  if (missing.length === 0) return [];
  return [
    {
      id: "missing-hygiene",
      title: "Missing basic documentation",
      detail: `No ${missing.join(" or ")} detected. If others are meant to use or evaluate this code, these set expectations fast.`,
      evidence: { note: missing.join(", ") },
    },
  ];
}

// 10. Commit cadence — steady rhythm across weeks is a positive signal even
// for solo projects. Looks for activity spread, not just volume.
function detectCommitCadence(snap: AnalysisSnapshot): HealthSignal[] {
  const weeks = snap.commitActivity ?? [];
  if (weeks.length < 6) return [];
  const activeWeeks = weeks.filter((w) => w.count > 0).length;
  const activeRatio = activeWeeks / weeks.length;
  if (activeRatio < 0.6) return [];
  return [
    {
      id: "consistent-cadence",
      title: "Consistent commit cadence",
      detail: `${activeWeeks} of the last ${weeks.length} sampled weeks had activity — steady development rhythm.`,
      evidence: {
        numbers: { activeWeeks, totalWeeks: weeks.length },
      },
    },
  ];
}

// 11. Positive test coverage — flip of detectUntestedHotspots. If the majority
// of hot code files have a discoverable test (sibling / import / name match),
// that's worth celebrating.
function detectGoodTestPresence(snap: AnalysisSnapshot): HealthSignal[] {
  const { allPaths, allTests } = collectPathIndices(snap);

  const codeHotspots = snap.hotspots
    .slice(0, 25)
    .filter((h) => isCodeFile(h.path));
  if (codeHotspots.length < 5) return [];
  const tested = codeHotspots.filter((h) =>
    hasTestCoverage(h, allPaths, allTests, snap.fileGraph)
  );
  const pct = Math.round((tested.length / codeHotspots.length) * 100);
  if (pct < 60) return [];
  return [
    {
      id: "good-test-presence",
      title: "Tests alongside hot code",
      detail: `${pct}% of the top-churn code files have a discoverable test — regressions should be caught early.`,
      evidence: {
        numbers: { pctTested: pct, sampled: codeHotspots.length },
      },
    },
  ];
}

// 12. Real code activity — flip of detectMetadataDominance. If the top churn
// is MOSTLY real code (not lockfiles / config), that's a healthy sign.
function detectRealCodeActivity(snap: AnalysisSnapshot): HealthSignal[] {
  const top = snap.hotspots.slice(0, 15);
  if (top.length < 10) return [];
  const metaCount = top.filter((h) => isMetadataFile(h.path)).length;
  const pct = Math.round((metaCount / top.length) * 100);
  if (pct > 20) return [];
  return [
    {
      id: "real-code-activity",
      title: "Active code development",
      detail: `Only ${pct}% of recent churn is metadata/config — the rest is genuine code work.`,
      evidence: {
        numbers: { metadataPct: pct, sampled: top.length },
      },
    },
  ];
}

// 13. Vulnerable dependencies — high severity. Aggregates across all
// ecosystems so a polyglot repo shows one signal: "30 vulnerable (22 npm, 3 cargo, 5 pypi)".
function detectVulnerableDeps(snap: AnalysisSnapshot): HealthSignal[] {
  const healths = getDependencyHealths(snap);
  // Grade Security on runtime/shipped deps only — a CVE in a dev/test/docs
  // pin isn't what a consumer of this repo is exposed to. Missing scope
  // (pre-provenance snapshots) is treated as runtime, so old data is unchanged.
  const vulns = collectAcrossEcosystems(healths, (h) => h.vulnerable).filter(
    (t) => t.dep.scope !== "dev"
  );
  if (vulns.length === 0) return [];

  const totalCves = vulns.reduce((s, t) => s + t.dep.cves.length, 0);
  const ecoBreakdown = summarizeByEcosystem(vulns);
  const topPackages = vulns
    .slice(0, 3)
    .map((t) => `[${t.ecosystem}] ${t.dep.name}@${t.dep.current}`);

  return [
    {
      id: "vulnerable-deps",
      title: `${vulns.length} vulnerable dependenc${vulns.length === 1 ? "y" : "ies"}`,
      detail: `${totalCves} known CVE${totalCves === 1 ? "" : "s"} across ${ecoBreakdown}. Top: ${topPackages.join(", ")}${vulns.length > 3 ? ` +${vulns.length - 3} more` : ""}.`,
      evidence: {
        paths: vulns
          .slice(0, 5)
          .map(
            (t) =>
              `[${t.ecosystem}] ${t.dep.name}@${t.dep.current} · ${t.dep.cves.slice(0, 2).join(", ")}`
          ),
        numbers: { packages: vulns.length, cves: totalCves },
      },
      severity: "high",
    },
  ];
}

// 14. Outdated dependencies — >=1 year behind across any ecosystem.
function detectOutdatedDeps(snap: AnalysisSnapshot): HealthSignal[] {
  const healths = getDependencyHealths(snap);
  // Supply grades on runtime deps — stale dev/test/docs pins (compiled
  // requirements locks, etc.) aren't the project's shipped supply chain.
  const outdated = collectAcrossEcosystems(healths, (h) => h.outdated).filter(
    (t) => t.dep.scope !== "dev"
  );
  const stale = outdated.filter((t) => t.dep.ageMonths >= 12);
  if (stale.length < 3) return [];

  // Sort by age desc for prose lead
  stale.sort((a, b) => b.dep.ageMonths - a.dep.ageMonths);
  const topThree = stale
    .slice(0, 3)
    .map((t) => `[${t.ecosystem}] ${t.dep.name} (${t.dep.ageMonths}m behind)`);
  const totalDeps = healths.reduce((s, h) => s + h.total, 0);

  return [
    {
      id: "outdated-deps",
      title: `${stale.length} packages ≥ 1 year behind`,
      detail: `Stalest: ${topThree.join(", ")}. Upgrade candidates for a debt-reduction sprint.`,
      evidence: {
        paths: stale
          .slice(0, 5)
          .map(
            (t) =>
              `[${t.ecosystem}] ${t.dep.name}: ${t.dep.current} → ${t.dep.latest}`
          ),
        numbers: {
          behind: stale.length,
          totalDeps,
          outdatedTotal: outdated.length,
        },
      },
      severity: stale.length > 10 ? "high" : "medium",
    },
  ];
}

// 15. Deprecated dependencies — explicitly marked as such in a registry.
function detectDeprecatedDeps(snap: AnalysisSnapshot): HealthSignal[] {
  const healths = getDependencyHealths(snap);
  const deps = collectAcrossEcosystems(healths, (h) => h.deprecated).filter(
    (t) => t.dep.scope !== "dev"
  );
  if (deps.length === 0) return [];

  const names = deps.slice(0, 3).map((t) => `[${t.ecosystem}] ${t.dep.name}`);
  return [
    {
      id: "deprecated-deps",
      title: `${deps.length} deprecated dependenc${deps.length === 1 ? "y" : "ies"}`,
      detail: `Explicitly deprecated: ${names.join(", ")}${deps.length > 3 ? ` +${deps.length - 3}` : ""}. Find maintained alternatives.`,
      evidence: {
        paths: deps
          .slice(0, 5)
          .map(
            (t) =>
              `[${t.ecosystem}] ${t.dep.name}@${t.dep.current}: ${t.dep.message.slice(0, 80)}`
          ),
        numbers: { count: deps.length },
      },
      severity: "medium",
    },
  ];
}

// 16. Fresh dependencies — counterpart to outdated. Must be clean across
// ALL ecosystems present on the snapshot.
function detectFreshDeps(snap: AnalysisSnapshot): HealthSignal[] {
  const healths = getDependencyHealths(snap);
  if (healths.length === 0) return [];
  const totalDeps = healths.reduce((s, h) => s + h.total, 0);
  if (totalDeps < 5) return [];

  // Freshness is judged on runtime deps — a CVE/staleness in a dev/test/docs
  // pin shouldn't deny a project the "fresh" positive. Missing scope = runtime.
  const isRuntime = (d: { scope?: string }) => d.scope !== "dev";
  const hasAnyCve = healths.some((h) => h.vulnerable.some(isRuntime));
  const hasAnyDeprecated = healths.some((h) => h.deprecated.some(isRuntime));
  if (hasAnyCve || hasAnyDeprecated) return [];

  // Any package ≥12 months behind → not fresh
  const anyYearBehind = healths.some((h) =>
    h.outdated.some((d) => isRuntime(d) && d.ageMonths >= 12)
  );
  if (anyYearBehind) return [];

  // Less than 20% can be even 6 months behind
  const somewhatStale = healths.reduce(
    (s, h) =>
      s + h.outdated.filter((d) => isRuntime(d) && d.ageMonths >= 6).length,
    0
  );
  if (somewhatStale > totalDeps * 0.2) return [];

  const ecoList = healths.map((h) => h.ecosystem).join(", ");
  return [
    {
      id: "fresh-deps",
      title: "Dependencies are fresh",
      detail: `${totalDeps} packages analyzed across ${ecoList} — no known CVEs, no deprecated entries, nothing more than 12 months behind.`,
      evidence: {
        numbers: { total: totalDeps, somewhatStale, ecosystems: healths.length },
      },
    },
  ];
}

// 17. Large contributor spread — many contributors = usually working
function detectContributorSpread(snap: AnalysisSnapshot): HealthSignal[] {
  // Exclude bots — dependabot et al. shouldn't count toward a "broad
  // contributor base" or inflate the participation curve.
  const humans = snap.contributors.filter((c) => !isBotAuthor(c.login));
  if (humans.length >= 20) {
    const top = humans.slice(0, 5);
    const topContribs = top.reduce((s, c) => s + c.contributions, 0);
    const allContribs = humans.reduce((s, c) => s + c.contributions, 0);
    const topShare = Math.round((topContribs / Math.max(1, allContribs)) * 100);
    return [
      {
        id: "many-contributors",
        title: "Broad contributor base",
        detail: `${humans.length}+ people have contributed; top 5 account for ${topShare}% — healthy participation curve.`,
        evidence: {
          numbers: {
            totalContributors: humans.length,
            top5SharePct: topShare,
          },
        },
      },
    ];
  }
  return [];
}

/**
 * Weak-Suite (Arc 1): flags "coverage that means nothing" — test cases that
 * execute code but assert nothing meaningful (no assertions, or only trivial
 * existence/truthiness/did-not-throw oracles). Reads the aggregate summary the
 * plugin+compute layer produced; the per-file drill-down lives on the Plus tab,
 * so this signal is aggregate-only (a safe free teaser, no file paths).
 */
function detectWeakSuite(snap: AnalysisSnapshot): {
  working: HealthSignal[];
  needsWork: HealthSignal[];
} {
  const ws = snap.weakSuite;
  if (!ws) return { working: [], needsWork: [] };
  const { totals } = ws;

  // Don't cry wolf on tiny suites — the ratio is noisy under ~15 cases.
  const MIN_CASES = 15;
  if (totals.testCases < MIN_CASES) return { working: [], needsWork: [] };

  const smokePct = Math.round(totals.smokeOnlyRatio * 100);
  const numbers = {
    testFiles: totals.testFiles,
    testCases: totals.testCases,
    assertions: totals.assertions,
    smokeOnlyCases: totals.smokeOnlyCases,
    smokeOnlyPct: smokePct,
    assertionDensity: totals.assertionDensity,
    hollowFiles: ws.counts.hollow,
    thinFiles: ws.counts.thin,
  };

  // Weak: a meaningful share of cases verify nothing. High when it's the
  // majority-ish; medium when it's a real minority.
  if (totals.smokeOnlyRatio >= 0.2) {
    return {
      working: [],
      needsWork: [
        {
          id: "weak-suite",
          title: "Tests run code without checking it",
          detail: `${smokePct}% of test cases (${totals.smokeOnlyCases} of ${totals.testCases}) execute code but assert nothing meaningful — coverage that wouldn't catch a regression. ${totals.assertionDensity} assertions per case across ${totals.testFiles} test files.`,
          evidence: { numbers },
          severity: totals.smokeOnlyRatio >= 0.4 ? "high" : "medium",
        },
      ],
    };
  }

  // Strong: dense, value-checking suite. Give healthy repos credit.
  if (totals.smokeOnlyRatio <= 0.1 && totals.assertionDensity >= 1.5) {
    return {
      working: [
        {
          id: "assertion-dense-tests",
          title: "Tests actually assert",
          detail: `${totals.assertionDensity} assertions per test case across ${totals.testCases} cases, only ${smokePct}% smoke-only — the suite checks values, not just that code runs.`,
          evidence: { numbers },
        },
      ],
      needsWork: [],
    };
  }

  return { working: [], needsWork: [] };
}

// ------------------- Aggregator -------------------

export function extractHealthSignals(snap: AnalysisSnapshot): HealthSignals {
  const working: HealthSignal[] = [];
  const needsWork: HealthSignal[] = [];
  const questions: HealthSignal[] = [];

  // Run solo detector first — its result gates other detectors (namely, we
  // don't double-report bus-factor concerns on a repo that's solo by nature).
  const soloSignals = detectSoloProject(snap);
  const isSoloProject = soloSignals.length > 0;
  questions.push(...soloSignals);

  const prThroughput = detectPrThroughput(snap);
  working.push(...prThroughput.working);
  needsWork.push(...prThroughput.needsWork);

  const prCycle = detectPrCycleTime(snap);
  working.push(...prCycle.working);
  needsWork.push(...prCycle.needsWork);

  const knowledge = detectKnowledgeDistribution(snap, isSoloProject);
  working.push(...knowledge.working);
  needsWork.push(...knowledge.needsWork);

  needsWork.push(...detectUntestedHotspots(snap));
  needsWork.push(...detectCrossBoundaryCoupling(snap));
  questions.push(...detectMetadataDominance(snap));

  // Deep import chains (v0.81+). The detector emits one signal max;
  // we bucket it by severity — "deep but tolerable" (6-8 levels) is
  // informational, "very deep" (9+ levels) is real refactoring risk.
  for (const sig of detectDeepDependencyChains(snap)) {
    if (sig.severity) needsWork.push(sig);
    else questions.push(sig);
  }

  const activity = detectActivityRecency(snap);
  working.push(...activity.working);
  needsWork.push(...activity.needsWork);

  questions.push(...detectMissingHygiene(snap));

  // Dependency-health detectors (from lib/depsHealth.ts data)
  needsWork.push(...detectVulnerableDeps(snap));
  needsWork.push(...detectOutdatedDeps(snap));
  needsWork.push(...detectDeprecatedDeps(snap));

  // Known supply-chain incidents (v0.81+ signal #19). Curated DB of
  // documented attacks where specific package versions are confirmed
  // compromised. Always high severity when matched — these are
  // documented attacks, not heuristics. Lives next to the rest of
  // the dep-health detectors so the Health-at-a-Glance "deps" tile
  // catches the signal automatically.
  needsWork.push(...detectKnownIncidents(snap));

  // Risky dynamic-execution patterns (v0.81+ signal #20). Bucketed
  // into questions — we can't classify legitimate codegen vs sneaky
  // payload without human context. Falls into "code" dimension on
  // Health-at-a-Glance.
  questions.push(...detectRiskyPatterns(snap));

  // Weak-Suite (Arc 1): assertion quality of the test suite — "coverage that
  // means nothing" as a risk, dense value-checking suites as a positive.
  const weakSuite = detectWeakSuite(snap);
  working.push(...weakSuite.working);
  needsWork.push(...weakSuite.needsWork);

  // Solo-friendly positive detectors — these fire on team projects too, but
  // they're especially important for giving solo projects credit where due.
  working.push(...detectCommitCadence(snap));
  working.push(...detectGoodTestPresence(snap));
  working.push(...detectRealCodeActivity(snap));
  working.push(...detectFreshDeps(snap));
  working.push(...detectContributorSpread(snap));

  // Sort needsWork by severity (high → low) so AI prose leads with the worst
  const sevRank = { high: 3, medium: 2, low: 1 } as const;
  needsWork.sort(
    (a, b) =>
      (b.severity ? sevRank[b.severity] : 0) -
      (a.severity ? sevRank[a.severity] : 0)
  );

  return { working, needsWork, questions };
}
