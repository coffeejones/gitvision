// Dependency-health orchestrator. Ecosystem-agnostic.
//
// Flow: fetch the repo's tree once, then for each registered plugin:
//   1. Filter tree → manifest paths this plugin handles
//   2. Fetch manifest content (parallel, concurrency-capped)
//   3. Let plugin parse manifests → declared (name, version, source) tuples
//   4. Dedupe on (name, version) so monorepos don't hit the registry N times
//   5. Fetch registry metadata for each unique pair (plugin's fetchMeta)
//   6. OSV.dev batch for CVEs (plugin's osvEcosystem string)
//   7. Categorize into outdated / vulnerable / deprecated with source paths
//
// Each plugin produces one DependencyHealth. Analysis returns the array.

import type { Octokit } from "octokit";
import type {
  DependencyHealth,
  OutdatedDep,
  VulnerableDep,
  DeprecatedDep,
  DepScope,
  SbomComponent,
} from "../types";
import { fetchRepoTree } from "./tree";
import { fetchOsvBatch } from "./osv";
import { mapWithConcurrency } from "./pool";
import { makeExcludeMatcher } from "../graph";
import type { EcosystemPlugin, DeclaredPackage } from "./types";

// Ecosystem plugins — add new ones here and nothing else changes.
import { npmPlugin } from "./ecosystems/npm";
import { cargoPlugin } from "./ecosystems/cargo";
import { pypiPlugin } from "./ecosystems/pypi";
import { cmpStr } from "../deterministicSort";

const PLUGINS: EcosystemPlugin[] = [npmPlugin, cargoPlugin, pypiPlugin];

const MAX_MANIFEST_FILES = 50; // per ecosystem
const MAX_UNIQUE_PACKAGES = 300; // per ecosystem (registry + OSV budget)
const MAX_SOURCES_PER_PACKAGE = 5; // how many source paths we keep on each issue
const OUTDATED_THRESHOLD_MONTHS = 6;

/** A manifest under one of these directories describes an EXAMPLE app, the
 *  docs/website, tests, a benchmark, or a playground — not the repo's shipped
 *  surface. Its deps are forced to the dev lane so a sample/docs pin can't
 *  FAIL the repo's verdict (e.g. flask's examples/celery declaring flask +
 *  celery as runtime, or a docs site pinning a vulnerable next). Convention-
 *  based and ecosystem-agnostic — the same dirs mean the same thing for
 *  npm, pypi and cargo. Real monorepo workspaces (packages/, crates/, apps/)
 *  are deliberately NOT here: those are first-party shipped code. */
const NON_SHIPPED_DIR =
  /(^|\/)(examples?|samples?|demos?|docs?|website|site|e2e|tests?|__tests__|fixtures?|benchmarks?|bench|integration|playground)\//i;

/** Public entry point — scans the whole repo tree once and runs every plugin
 *  whose manifests are present. Returns one DependencyHealth per ecosystem. */
export async function analyzeDependencyHealth(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref = "HEAD",
  excludeFolders: string[] = []
): Promise<DependencyHealth[]> {
  const tree = await fetchRepoTree(octokit, owner, repo, ref);
  if (tree.length === 0) return [];

  // Respect exclude-folders: a manifest under an excluded dir (a vendored
  // example, a deprecated package) shouldn't contribute to dep-health.
  const isExcluded =
    excludeFolders.length > 0 ? makeExcludeMatcher(excludeFolders) : null;

  const results: DependencyHealth[] = [];
  for (const plugin of PLUGINS) {
    const manifestPaths = tree.filter(
      (p) => plugin.isManifest(p) && !(isExcluded && isExcluded(p))
    );
    if (manifestPaths.length === 0) continue;
    const capped = manifestPaths
      .sort((a, b) => a.split("/").length - b.split("/").length) // root-first
      .slice(0, MAX_MANIFEST_FILES);

    const result = await runPluginPipeline(plugin, capped, {
      octokit,
      owner,
      repo,
    });
    if (result) results.push(result);
  }
  return results;
}

// ------------------- Shared pipeline -------------------

interface RepoCtx {
  octokit: Octokit;
  owner: string;
  repo: string;
}

async function fetchFileContent(
  ctx: RepoCtx,
  path: string
): Promise<string | null> {
  try {
    const { data } = await ctx.octokit.rest.repos.getContent({
      owner: ctx.owner,
      repo: ctx.repo,
      path,
    });
    if (!("content" in data) || typeof data.content !== "string") return null;
    return Buffer.from(data.content, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

async function runPluginPipeline(
  plugin: EcosystemPlugin,
  manifestPaths: string[],
  ctx: RepoCtx
): Promise<DependencyHealth | null> {
  // 1. Fetch all manifests for this ecosystem
  const manifestContents = await mapWithConcurrency(
    manifestPaths,
    5,
    async (path) => ({ path, content: await fetchFileContent(ctx, path) })
  );
  const validManifests = manifestContents.filter(
    (m): m is { path: string; content: string } => typeof m.content === "string"
  );
  if (validManifests.length === 0) return null;

  // 2a. Collect the project's own package name(s) so a repo that pins itself
  //     in a lockfile/docs/CI file isn't reported as its own dependency
  //     (e.g. flask listing flask). Names are normalized by the plugin.
  const selfNames = new Set<string>();
  for (const m of validManifests) {
    const n = plugin.selfName?.(m.path, m.content);
    if (n) selfNames.add(n);
  }

  // 2b. Parse each into declared packages, dropping self-references and
  //     forcing deps from non-shipped dirs (examples/docs/tests/…) to dev.
  const declared: DeclaredPackage[] = [];
  for (const m of validManifests) {
    const nonShipped = NON_SHIPPED_DIR.test(m.path);
    for (const d of plugin.parseManifest(m.path, m.content)) {
      if (selfNames.has(d.name)) continue;
      declared.push(nonShipped ? { ...d, scope: "dev" } : d);
    }
  }
  if (declared.length === 0) return null;

  // 3. Dedupe on (name, version); track sources + resolved lane per key.
  //    Runtime wins: a package declared as both runtime and dev is runtime.
  const sourcesByKey = new Map<string, Set<string>>();
  const uniqueByKey = new Map<string, { name: string; declared: string }>();
  const scopeByKey = new Map<string, DepScope>();
  for (const d of declared) {
    const key = `${d.name}@${d.declared}`;
    if (!uniqueByKey.has(key)) {
      uniqueByKey.set(key, { name: d.name, declared: d.declared });
    }
    const set = sourcesByKey.get(key) ?? new Set<string>();
    set.add(d.sourcePath);
    sourcesByKey.set(key, set);
    const prev = scopeByKey.get(key);
    scopeByKey.set(
      key,
      prev === "runtime" || d.scope === "runtime" ? "runtime" : "dev"
    );
  }

  const entries = [...uniqueByKey.entries()];
  const capped = entries.slice(0, MAX_UNIQUE_PACKAGES);
  const truncated =
    entries.length > MAX_UNIQUE_PACKAGES
      ? `Analyzed first ${MAX_UNIQUE_PACKAGES} of ${entries.length} unique packages across ${validManifests.length} manifests`
      : undefined;

  // 4. Fetch registry meta (concurrency 10). `exact` distinguishes a pinned
  //    version (assess as-is) from a range/floor (assess at the resolved ≈
  //    latest version, since that's what a fresh install gets).
  const withMeta = await mapWithConcurrency(capped, 10, async ([key, d]) => {
    const exact = plugin.isExactVersion?.(d.declared) ?? true;
    const current = plugin.normalizeVersion(d.declared);
    if (!current) return { key, ...d, exact, current: null, meta: null };
    const meta = await plugin.fetchMeta(d.name, current);
    return { key, ...d, exact, current, meta };
  });

  // 5. OSV batch. For a range/floor, check the resolved (latest) version —
  //    flagging a `>=3.1.2` floor for a CVE fixed in 3.1.3 is a false
  //    positive, since the range resolves to a patched release.
  const osvReady = withMeta
    .filter(
      (d): d is typeof d & { current: string } => typeof d.current === "string"
    )
    .map((d) => ({
      key: d.key,
      name: d.name,
      version: d.exact ? d.current : d.meta?.latest ?? d.current,
      ecosystem: plugin.osvEcosystem,
    }));
  const osvCves = await fetchOsvBatch(osvReady);
  const cvesByKey = new Map<string, string[]>();
  osvReady.forEach((q, i) => {
    if (osvCves[i]?.length) cvesByKey.set(q.key, osvCves[i]);
  });

  // 6. Categorize
  const outdated: OutdatedDep[] = [];
  const vulnerable: VulnerableDep[] = [];
  const deprecated: DeprecatedDep[] = [];

  function sourcesFor(key: string): string[] | undefined {
    const set = sourcesByKey.get(key);
    if (!set || set.size === 0) return undefined;
    return [...set].sort().slice(0, MAX_SOURCES_PER_PACKAGE);
  }

  for (const d of withMeta) {
    const scope = scopeByKey.get(d.key);
    if (d.meta?.deprecated) {
      deprecated.push({
        name: d.name,
        current: d.declared,
        message: d.meta.deprecated,
        sources: sourcesFor(d.key),
        scope,
      });
    }

    // Only EXACT pins can be "behind" — a range/floor resolves to the latest
    // matching release, so it's never outdated by definition.
    if (d.exact && d.current && d.meta?.latest && d.current !== d.meta.latest) {
      if (d.meta.timeOfCurrent && d.meta.timeOfLatest) {
        const ageMs =
          new Date(d.meta.timeOfLatest).getTime() -
          new Date(d.meta.timeOfCurrent).getTime();
        const ageMonths = Math.round(ageMs / (1000 * 60 * 60 * 24 * 30));
        if (ageMonths >= OUTDATED_THRESHOLD_MONTHS) {
          outdated.push({
            name: d.name,
            current: d.declared,
            latest: d.meta.latest,
            ageMonths,
            lastPublished: d.meta.timeOfLatest,
            sources: sourcesFor(d.key),
            scope,
          });
        }
      }
    }

    const cves = cvesByKey.get(d.key);
    if (cves && cves.length > 0) {
      vulnerable.push({
        name: d.name,
        current: d.declared,
        cves: cves.slice(0, 5),
        sources: sourcesFor(d.key),
        scope,
      });
    }
  }

  outdated.sort((a, b) => b.ageMonths - a.ageMonths);
  vulnerable.sort((a, b) => b.cves.length - a.cves.length);

  const totalDeclarations = [...sourcesByKey.values()].reduce(
    (s, set) => s + set.size,
    0
  );

  // Full declared-component list for SBOM export (Arc 4) — every analyzed
  // package at its resolved concrete version, not just the problematic subset.
  // Range specs use the version they resolve to (meta.latest); packages we
  // couldn't resolve to a concrete version are omitted (can't produce a purl).
  const components: SbomComponent[] = [];
  for (const d of withMeta) {
    const version = d.exact ? d.current : d.meta?.latest ?? d.current;
    if (!version) continue;
    components.push({
      name: d.name,
      version,
      scope: scopeByKey.get(d.key) ?? "runtime",
    });
  }
  components.sort(
    (a, b) => cmpStr(a.name, b.name) || cmpStr(a.version, b.version)
  );

  return {
    ecosystem: plugin.name,
    total: totalDeclarations,
    uniquePackages: uniqueByKey.size,
    packageFiles: validManifests.length,
    outdated,
    vulnerable,
    deprecated,
    components,
    analyzedAt: new Date().toISOString(),
    note: truncated,
  };
}

/** Convenience helper for callers that want normalized access across old
 *  and new snapshot shapes. Old snapshots had `dependencyHealth` (singular);
 *  new ones have `dependencyHealths` (plural). */
export function getDependencyHealths(snap: {
  dependencyHealth?: DependencyHealth;
  dependencyHealths?: DependencyHealth[];
}): DependencyHealth[] {
  if (snap.dependencyHealths && snap.dependencyHealths.length > 0) {
    return snap.dependencyHealths;
  }
  if (snap.dependencyHealth) return [snap.dependencyHealth];
  return [];
}
