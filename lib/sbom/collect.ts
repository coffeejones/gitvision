// Gather a snapshot's declared components into the format-agnostic SbomInput.
// Returns null when the snapshot has no captured components (pre-SBOM sweep or a
// repo with no manifests) — the caller surfaces a "refresh to generate" state.

import type { AnalysisSnapshot } from "../types";
import type { SbomComponentInput, SbomInput } from "./types";
import { toPurl } from "./purl";

export function collectSbom(snap: AnalysisSnapshot): SbomInput | null {
  const healths =
    snap.dependencyHealths ??
    (snap.dependencyHealth ? [snap.dependencyHealth] : []);

  const seen = new Set<string>();
  const components: SbomComponentInput[] = [];
  for (const h of healths) {
    for (const c of h.components ?? []) {
      const purl = toPurl(h.ecosystem, c.name, c.version);
      if (seen.has(purl)) continue; // one component per unique purl
      seen.add(purl);
      components.push({
        ecosystem: h.ecosystem,
        name: c.name,
        version: c.version,
        scope: c.scope,
        purl,
      });
    }
  }

  if (components.length === 0) return null;
  components.sort((a, b) => a.purl.localeCompare(b.purl));

  return {
    repoName: snap.repo.fullName,
    repoVersion: snap.analyzedRef ?? "HEAD",
    timestamp: snap.fetchedAt,
    components,
  };
}
