// Coverage for the SBOM generator (lib/sbom/).

import { describe, it, expect } from "vitest";
import type { AnalysisSnapshot } from "../types";
import { generateSbom, sbomComponentCount, collectSbom } from "../sbom";
import { toPurl } from "../sbom/purl";
import { TIER_CONFIG } from "../pricing";
import { minimumTierFor } from "../billing/gates";

function snap(over: Partial<AnalysisSnapshot> = {}): AnalysisSnapshot {
  return {
    repo: { fullName: "octocat/Hello-World" },
    fetchedAt: "2026-07-08T12:00:00.000Z",
    analyzedRef: "abc123",
    dependencyHealths: [
      {
        ecosystem: "npm",
        total: 3,
        outdated: [],
        vulnerable: [],
        deprecated: [],
        analyzedAt: "2026-07-08T12:00:00.000Z",
        components: [
          { name: "@angular/core", version: "17.0.0", scope: "runtime" },
          { name: "lodash", version: "4.17.21", scope: "runtime" },
          { name: "jest", version: "29.0.0", scope: "dev" },
        ],
      },
      {
        ecosystem: "pypi",
        total: 1,
        outdated: [],
        vulnerable: [],
        deprecated: [],
        analyzedAt: "2026-07-08T12:00:00.000Z",
        components: [{ name: "Flask_SQLAlchemy", version: "3.0.0", scope: "runtime" }],
      },
    ],
    ...over,
  } as unknown as AnalysisSnapshot;
}

describe("toPurl", () => {
  it("encodes npm scopes, normalizes pypi names, handles cargo", () => {
    expect(toPurl("npm", "@angular/core", "17.0.0")).toBe("pkg:npm/%40angular/core@17.0.0");
    expect(toPurl("npm", "lodash", "4.17.21")).toBe("pkg:npm/lodash@4.17.21");
    expect(toPurl("pypi", "Flask_SQLAlchemy", "3.0.0")).toBe("pkg:pypi/flask-sqlalchemy@3.0.0");
    expect(toPurl("cargo", "serde", "1.0.0")).toBe("pkg:cargo/serde@1.0.0");
  });
});

describe("collectSbom", () => {
  it("flattens components across ecosystems, deduped + purl'd", () => {
    const input = collectSbom(snap());
    expect(input).not.toBeNull();
    expect(input!.repoName).toBe("octocat/Hello-World");
    expect(input!.repoVersion).toBe("abc123");
    expect(input!.timestamp).toBe("2026-07-08T12:00:00.000Z");
    expect(input!.components).toHaveLength(4);
    expect(input!.components.map((c) => c.purl)).toContain("pkg:pypi/flask-sqlalchemy@3.0.0");
  });

  it("returns null on a pre-SBOM snapshot (no captured components)", () => {
    expect(collectSbom(snap({ dependencyHealths: [] }))).toBeNull();
    expect(sbomComponentCount(snap({ dependencyHealths: [] }))).toBe(0);
  });
});

describe("generateSbom — CycloneDX", () => {
  it("produces a valid CycloneDX 1.5 document", () => {
    const out = generateSbom(snap(), "cyclonedx")!;
    expect(out.filename).toBe("octocat-hello-world.cdx.json");
    expect(out.contentType).toContain("cyclonedx");
    const doc = JSON.parse(out.body);
    expect(doc.bomFormat).toBe("CycloneDX");
    expect(doc.specVersion).toBe("1.5");
    expect(doc.metadata.timestamp).toBe("2026-07-08T12:00:00.000Z");
    expect(doc.components).toHaveLength(4);
    const jest = doc.components.find((c: { name: string }) => c.name === "jest");
    expect(jest.scope).toBe("optional"); // dev → optional
    const lodash = doc.components.find((c: { name: string }) => c.name === "lodash");
    expect(lodash.scope).toBe("required");
    expect(lodash.purl).toBe("pkg:npm/lodash@4.17.21");
    // supplier present (NTIA element) as a known-unknown
    expect(lodash.supplier).toEqual({ name: "NOASSERTION" });
    // direct dependency relationship: root depends on all
    expect(doc.dependencies[0].dependsOn).toHaveLength(4);
  });
});

describe("generateSbom — SPDX", () => {
  it("produces a valid SPDX 2.3 document", () => {
    const out = generateSbom(snap(), "spdx")!;
    expect(out.filename).toBe("octocat-hello-world.spdx.json");
    expect(out.contentType).toContain("spdx");
    const doc = JSON.parse(out.body);
    expect(doc.spdxVersion).toBe("SPDX-2.3");
    expect(doc.SPDXID).toBe("SPDXRef-DOCUMENT");
    // `created` must be SECOND precision — the SPDX validator rejects millis
    expect(doc.creationInfo.created).toBe("2026-07-08T12:00:00Z");
    expect(doc.creationInfo.created).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    // root + 4 components
    expect(doc.packages).toHaveLength(5);
    // every package id is a valid SPDXRef, and carries filesAnalyzed + supplier
    for (const p of doc.packages) {
      expect(p.SPDXID).toMatch(/^SPDXRef-[A-Za-z0-9.-]+$/);
      expect(p.filesAnalyzed).toBe(false); // manifest-only → no verification code needed
      expect(p.supplier).toBe("NOASSERTION"); // NTIA supplier element present
    }
    // a component carries its purl as an externalRef
    const withPurl = doc.packages.find(
      (p: { externalRefs?: { referenceLocator: string }[] }) =>
        p.externalRefs?.some((r) => r.referenceLocator === "pkg:npm/lodash@4.17.21"),
    );
    expect(withPurl).toBeDefined();
    // relationships: 1 DESCRIBES + 4 DEPENDS_ON
    expect(doc.relationships.filter((r: { relationshipType: string }) => r.relationshipType === "DESCRIBES")).toHaveLength(1);
    expect(doc.relationships.filter((r: { relationshipType: string }) => r.relationshipType === "DEPENDS_ON")).toHaveLength(4);
  });
});

describe("generateSbom — guards", () => {
  it("returns null when there are no components", () => {
    expect(generateSbom(snap({ dependencyHealths: [] }), "cyclonedx")).toBeNull();
    expect(generateSbom(snap({ dependencyHealths: [] }), "spdx")).toBeNull();
  });
});

describe("sbomExport gating (Pro-only)", () => {
  it("is granted by Pro only — never Free or Plus", () => {
    expect(TIER_CONFIG["open-case"].limits.sbomExport).toBe(false); // Free
    expect(TIER_CONFIG["standing-docket"].limits.sbomExport).toBe(false); // Plus
    expect(TIER_CONFIG["full-bench"].limits.sbomExport).toBe(true); // Pro
    expect(minimumTierFor("sbomExport")).toBe("full-bench");
  });
});
