// Shared types for the dependency-health plugin architecture.
//
// Each supported package manager implements EcosystemPlugin. The orchestrator
// in index.ts runs the same pipeline against each plugin:
//   tree → manifests → declared packages → registry meta → OSV CVE lookup.
//
// Adding a new ecosystem = create a new file in ./ecosystems/ implementing
// EcosystemPlugin, then import it into the PLUGINS array in index.ts. No
// changes to types, signals, UI, or storage should be necessary.

import type { Octokit } from "octokit";
import type { DepScope } from "../types";

/** String union kept loose so plugins added later don't require a central
 *  refactor. Existing consumers should treat unknown values as opaque. */
export type Ecosystem = "npm" | "cargo" | "pypi" | (string & {});

/** A package declaration parsed directly from a manifest file — before any
 *  registry enrichment. */
export interface DeclaredPackage {
  name: string;
  declared: string; // raw version string as written in the manifest
  sourcePath: string; // manifest file that declared it (e.g. "packages/x/package.json")
  /** Runtime (shipped) vs dev/test/docs/build. Set by the plugin from the
   *  manifest section / file the dep came from. The verdict grades on
   *  runtime; dev-scope deps stay visible but don't drive a Failed ruling. */
  scope: DepScope;
}

/** Registry-enriched metadata for a single package at a specific version. */
export interface PackageMeta {
  latest: string | null;
  timeOfCurrent: string | null; // ISO date when `current` was published
  timeOfLatest: string | null; // ISO date when `latest` was published
  deprecated: string | null; // message if deprecated, otherwise null
}

export interface EcosystemPlugin {
  /** Stable identifier ("npm", "cargo", "pypi", ...) — also serialized to the snapshot. */
  readonly name: Ecosystem;
  /** Human-facing label for UI and AI prompts. */
  readonly displayName: string;
  /** OSV.dev ecosystem string (different from our `name` in some cases — e.g. Rust is "crates.io"). */
  readonly osvEcosystem: string;

  /** Given a path from the repo tree, is it a manifest this plugin parses? */
  isManifest(path: string): boolean;

  /** Parse raw manifest content into declared packages. Return empty array on
   *  parse failure so one bad file doesn't sink the whole plugin. */
  parseManifest(path: string, content: string): DeclaredPackage[];

  /** The package's OWN name as declared in this manifest, normalized the same
   *  way parseManifest normalizes dependency names. Lets the orchestrator drop
   *  a project from its own dependency list (e.g. a lockfile/docs pin that
   *  installs the package itself — flask listing flask). Null when the manifest
   *  declares no own name (e.g. a requirements.txt). Optional: a plugin without
   *  it simply doesn't self-exclude. */
  selfName?(path: string, content: string): string | null;

  /** Strip range syntax ("^1.2.3", "~2", ">=3.0 <4") down to a concrete version
   *  string. Return null for non-concrete specs (URLs, file paths, "*", etc.)
   *  — we'll skip registry/OSV lookups for those but still count them. */
  normalizeVersion(raw: string): string | null;

  /** Is the raw spec an EXACT pin (the installed version is known) vs a
   *  range/floor (^1.2, >=3, ~=2, cargo's bare caret) that resolves to the
   *  latest matching release? Assessment differs: a pin is checked as-is; a
   *  range is assessed at the resolved (≈ latest) version, because that's what
   *  a fresh install gets — flagging a `>=3.1.2` floor for a CVE fixed in
   *  3.1.3 is a false positive. Optional — a plugin without it is treated as
   *  always-exact (prior behavior). */
  isExactVersion?(raw: string): boolean;

  /** Fetch registry metadata for a concrete (name, version) pair. Should return
   *  null on any error — we catch individual failures without failing the run. */
  fetchMeta(name: string, version: string): Promise<PackageMeta | null>;
}

/** The octokit + repo triple every plugin needs to read manifest file content. */
export interface RepoContext {
  octokit: Octokit;
  owner: string;
  repo: string;
}
