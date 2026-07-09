// SBOM generation types (Arc 4 — Evidence Desk). Client-safe.

export type SbomFormat = "cyclonedx" | "spdx";

/** A component ready for serialization — the collected dep plus its purl. */
export interface SbomComponentInput {
  ecosystem: string;
  name: string;
  version: string;
  scope: "runtime" | "dev";
  /** package-URL identity, e.g. "pkg:npm/lodash@4.17.21". */
  purl: string;
}

/** Everything a serializer needs, gathered from a snapshot. */
export interface SbomInput {
  /** owner/repo. */
  repoName: string;
  /** Commit ref/sha analyzed, or "HEAD" when unknown. */
  repoVersion: string;
  /** ISO timestamp the deps were captured (the snapshot's fetch time) — the
   *  SBOM is evidence "as of" this moment, so it stays deterministic. */
  timestamp: string;
  /** Distinct components, sorted, each with a purl. */
  components: SbomComponentInput[];
}
