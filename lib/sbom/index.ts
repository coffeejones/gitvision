// SBOM generation entry point (Arc 4 — Evidence Desk). Turns a snapshot into a
// downloadable CycloneDX or SPDX document. Pure over the snapshot, so it's fully
// unit-testable; the download route just gates + streams the result.

import type { AnalysisSnapshot } from "../types";
import { collectSbom } from "./collect";
import { buildCycloneDx } from "./cyclonedx";
import { buildSpdx } from "./spdx";
import type { SbomFormat } from "./types";

export type { SbomFormat } from "./types";
export { collectSbom } from "./collect";

export interface GeneratedSbom {
  filename: string;
  contentType: string;
  body: string;
}

function repoSlug(repoName: string): string {
  return repoName.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

/** Generate an SBOM document, or null when the snapshot has no captured
 *  components (pre-SBOM sweep — needs a refresh). */
export function generateSbom(
  snap: AnalysisSnapshot,
  format: SbomFormat,
): GeneratedSbom | null {
  const input = collectSbom(snap);
  if (!input) return null;

  const slug = repoSlug(input.repoName) || "repo";

  if (format === "spdx") {
    return {
      filename: `${slug}.spdx.json`,
      contentType: "application/spdx+json; charset=utf-8",
      body: JSON.stringify(buildSpdx(input), null, 2),
    };
  }
  return {
    filename: `${slug}.cdx.json`,
    contentType: "application/vnd.cyclonedx+json; charset=utf-8",
    body: JSON.stringify(buildCycloneDx(input), null, 2),
  };
}

/** How many components an SBOM would contain (0 = not available on this
 *  snapshot). Cheap; used by the UI to enable/disable the download. */
export function sbomComponentCount(snap: AnalysisSnapshot): number {
  return collectSbom(snap)?.components.length ?? 0;
}
