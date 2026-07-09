// SPDX 2.3 JSON serializer. Package SPDXIDs are index-based so they always
// satisfy the `SPDXRef-[a-zA-Z0-9.-]+` grammar regardless of package name.
// Every package carries a `supplier` and licenses (NOASSERTION where we don't
// resolve them — a known-unknown, not an omission) and `filesAnalyzed: false`
// (manifest-only: no files hashed, so no packageVerificationCode is needed).
// The `created` timestamp is emitted at second precision, which SPDX requires.

import type { SbomInput } from "./types";

const DOC_ID = "SPDXRef-DOCUMENT";
const ROOT_ID = "SPDXRef-Package-root";

function pkgId(i: number): string {
  return `SPDXRef-Package-${i}`;
}

function sanitizeNamespace(s: string): string {
  return s.replace(/[^a-zA-Z0-9.-]+/g, "-");
}

/** SPDX 2.3 requires `created` at second precision (YYYY-MM-DDThh:mm:ssZ) —
 *  the reference validator rejects the milliseconds that toISOString() emits. */
function spdxTime(iso: string): string {
  return iso.replace(/\.\d{3}Z$/, "Z");
}

export function buildSpdx(input: SbomInput): object {
  const packages = [
    {
      SPDXID: ROOT_ID,
      name: input.repoName,
      versionInfo: input.repoVersion,
      downloadLocation: "NOASSERTION",
      filesAnalyzed: false,
      supplier: "NOASSERTION",
      licenseConcluded: "NOASSERTION",
      licenseDeclared: "NOASSERTION",
      copyrightText: "NOASSERTION",
    },
    ...input.components.map((c, i) => ({
      SPDXID: pkgId(i),
      name: c.name,
      versionInfo: c.version,
      downloadLocation: "NOASSERTION",
      filesAnalyzed: false,
      supplier: "NOASSERTION",
      licenseConcluded: "NOASSERTION",
      licenseDeclared: "NOASSERTION",
      copyrightText: "NOASSERTION",
      externalRefs: [
        {
          referenceCategory: "PACKAGE-MANAGER",
          referenceType: "purl",
          referenceLocator: c.purl,
        },
      ],
    })),
  ];

  const relationships = [
    {
      spdxElementId: DOC_ID,
      relatedSpdxElement: ROOT_ID,
      relationshipType: "DESCRIBES",
    },
    ...input.components.map((_, i) => ({
      spdxElementId: ROOT_ID,
      relatedSpdxElement: pkgId(i),
      relationshipType: "DEPENDS_ON",
    })),
  ];

  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: DOC_ID,
    name: `${input.repoName}-sbom`,
    documentNamespace: `https://codetrawl.com/spdx/${sanitizeNamespace(
      input.repoName,
    )}-${input.timestamp}`,
    creationInfo: {
      created: spdxTime(input.timestamp),
      creators: ["Tool: CodeTrawl-SBOM-1.0", "Organization: CodeTrawl"],
    },
    packages,
    relationships,
  };
}
