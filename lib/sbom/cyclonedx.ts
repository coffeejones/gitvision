// CycloneDX 1.5 JSON serializer. 1.5's `tools` array is the most widely
// consumed shape (Dependency-Track, Grype, Trivy). Manifest-scoped: every
// component is a DIRECT dependency of the repo root — we don't claim a
// transitive graph we didn't resolve.

import type { SbomInput } from "./types";

export function buildCycloneDx(input: SbomInput): object {
  const rootRef = `codetrawl:${input.repoName}@${input.repoVersion}`;

  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: {
      timestamp: input.timestamp,
      tools: [{ vendor: "CodeTrawl", name: "CodeTrawl SBOM", version: "1.0" }],
      component: {
        type: "application",
        "bom-ref": rootRef,
        name: input.repoName,
        version: input.repoVersion,
        supplier: { name: "NOASSERTION" },
      },
    },
    components: input.components.map((c) => ({
      type: "library",
      "bom-ref": c.purl,
      name: c.name,
      version: c.version,
      purl: c.purl,
      // CycloneDX scope: required = runtime, optional = dev/test.
      scope: c.scope === "dev" ? "optional" : "required",
      // Supplier present as a known-unknown — registry-derived supplier is a
      // follow-up (matches the SPDX NOASSERTION supplier).
      supplier: { name: "NOASSERTION" },
    })),
    // Direct dependency relationship (manifest-level): the root depends on each
    // declared component. Sub-dependencies are intentionally omitted.
    dependencies: [{ ref: rootRef, dependsOn: input.components.map((c) => c.purl) }],
  };
}
