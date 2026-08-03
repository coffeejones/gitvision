// Evidence pack (Arc 4, beat 4) — bundles a session's security/supply-chain
// evidence into files ready to zip: the SBOMs, a machine-readable evidence.json,
// and a human-readable SUMMARY.md. Pure over the session (the zip assembly +
// fs/route live elsewhere), so it's unit-testable.
//
// Secret hygiene is included as COUNTS ONLY — never the values or redacted
// previews. Bundling secret material would defeat the purpose.

import type { AnalysisSnapshot, DependencyHealth, Session } from "../types";
import { computeVerdict, verdictFor } from "../intelligence/verdict";
import { generateSbom } from "../sbom";

export interface EvidenceFile {
  name: string;
  content: string;
}

const SCOPE_STATEMENT =
  "Manifest-based analysis of the repository at the analyzed commit. Direct declared dependencies only — roughly 16% of dependencies can enter off-manifest (lockfile-only, vendored, or dynamically loaded) and are not represented. Per-component suppliers and licenses are NOASSERTION in this version. This is evidence for a technical file, not a certification of compliance.";

function healthsOf(snap: AnalysisSnapshot): DependencyHealth[] {
  return (
    snap.dependencyHealths ??
    (snap.dependencyHealth ? [snap.dependencyHealth] : [])
  );
}

function repoSlug(name: string): string {
  return (
    name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() ||
    "repo"
  );
}

interface EvidenceObject {
  tool: string;
  repository: { name: string; ref: string; analyzedAt: string };
  verdict: { grade: string; score: number; outcome: string };
  scope: string;
  dependencies: {
    ecosystems: Array<{
      ecosystem: string;
      total: number;
      uniquePackages: number | null;
      vulnerable: number;
      outdated: number;
      deprecated: number;
    }>;
    vulnerable: Array<{ ecosystem: string; name: string; version: string; cves: string[] }>;
  };
  ciHardening:
    | {
        posture: string;
        workflows: number;
        findings: Array<{ id: string; severity: string; title: string; count: number }>;
      }
    | null;
  secretHygiene: {
    scanned: boolean;
    findingsBySeverity: { critical: number; high: number; medium: number };
    note: string;
  };
  reSweepTrail: Array<{ date: string; ref: string | null; grade: string }>;
  sbom: { included: boolean; files?: string[]; formats?: string; note?: string };
}

export function buildEvidenceObject(session: Session): EvidenceObject {
  const snaps = session.snapshots;
  const latest = snaps[snaps.length - 1];
  const verdict = computeVerdict(latest);
  const healths = healthsOf(latest);

  const dependencies = {
    ecosystems: healths.map((h) => ({
      ecosystem: h.ecosystem,
      total: h.total,
      uniquePackages: h.uniquePackages ?? null,
      vulnerable: h.vulnerable.length,
      outdated: h.outdated.length,
      deprecated: h.deprecated.length,
    })),
    vulnerable: healths.flatMap((h) =>
      h.vulnerable.map((v) => ({
        ecosystem: h.ecosystem,
        name: v.name,
        version: v.current,
        cves: v.cves,
      })),
    ),
  };

  // Secret hygiene — severity COUNTS only.
  const findingsBySeverity = { critical: 0, high: 0, medium: 0 };
  const scanned = !!latest.secretFindings;
  if (latest.secretFindings) {
    for (const f of latest.secretFindings.findings) {
      findingsBySeverity[f.severity] = (findingsBySeverity[f.severity] ?? 0) + 1;
    }
  }

  const ciHardening = latest.ciHardening
    ? {
        posture: latest.ciHardening.posture,
        workflows: latest.ciHardening.workflowCount,
        findings: latest.ciHardening.findings.map((f) => ({
          id: f.id,
          severity: f.severity,
          title: f.title,
          count: f.count,
        })),
      }
    : null;

  const reSweepTrail = snaps.map((s) => ({
    date: s.fetchedAt,
    ref: s.analyzedRef ?? null,
    grade: verdictFor(s).grade,
  }));

  const hasSbom = generateSbom(latest, "cyclonedx") !== null;

  return {
    tool: "CodeTrawl evidence pack 1.0",
    repository: {
      name: latest.repo.fullName,
      ref: latest.analyzedRef ?? "HEAD",
      analyzedAt: latest.fetchedAt,
    },
    verdict: { grade: verdict.grade, score: verdict.score, outcome: verdict.outcome },
    scope: SCOPE_STATEMENT,
    dependencies,
    ciHardening,
    secretHygiene: {
      scanned,
      findingsBySeverity,
      note: "Counts only — secret values are never included in this pack.",
    },
    reSweepTrail,
    sbom: hasSbom
      ? {
          included: true,
          files: ["sbom.cdx.json", "sbom.spdx.json"],
          formats: "CycloneDX 1.5 + SPDX 2.3",
        }
      : {
          included: false,
          note: "No components captured on this snapshot — refresh the session to include an SBOM.",
        },
  };
}

function buildSummaryMarkdown(e: EvidenceObject): string {
  const lines: string[] = [];
  lines.push(`# CodeTrawl evidence pack — ${e.repository.name}`);
  lines.push("");
  lines.push(`- **Repository:** ${e.repository.name} @ \`${e.repository.ref}\``);
  lines.push(`- **Analyzed:** ${e.repository.analyzedAt}`);
  lines.push(`- **Verdict:** ${e.verdict.grade} (score ${e.verdict.score}, ${e.verdict.outcome})`);
  lines.push(`- **Generated by:** ${e.tool}`);
  lines.push("");
  lines.push("## Scope");
  lines.push("");
  lines.push(e.scope);
  lines.push("");

  lines.push("## Dependencies");
  lines.push("");
  if (e.dependencies.ecosystems.length === 0) {
    lines.push("_No package manifests detected._");
  } else {
    lines.push("| Ecosystem | Declarations | Vulnerable | Outdated | Deprecated |");
    lines.push("|---|--:|--:|--:|--:|");
    for (const eco of e.dependencies.ecosystems) {
      lines.push(
        `| ${eco.ecosystem} | ${eco.total} | ${eco.vulnerable} | ${eco.outdated} | ${eco.deprecated} |`,
      );
    }
    if (e.dependencies.vulnerable.length > 0) {
      lines.push("");
      lines.push("### Known-vulnerable packages");
      lines.push("");
      for (const v of e.dependencies.vulnerable) {
        lines.push(`- \`[${v.ecosystem}] ${v.name}@${v.version}\` — ${v.cves.join(", ")}`);
      }
    }
  }
  lines.push("");

  lines.push("## CI hardening");
  lines.push("");
  if (!e.ciHardening) {
    lines.push("_No GitHub Actions workflows analyzed._");
  } else {
    lines.push(`Posture: **${e.ciHardening.posture}** across ${e.ciHardening.workflows} workflow(s).`);
    lines.push("");
    for (const f of e.ciHardening.findings) {
      lines.push(`- **[${f.severity}]** ${f.title}`);
    }
  }
  lines.push("");

  lines.push("## Secret hygiene");
  lines.push("");
  if (!e.secretHygiene.scanned) {
    lines.push("_No secret scan on this snapshot._");
  } else {
    const s = e.secretHygiene.findingsBySeverity;
    lines.push(`Findings — critical: ${s.critical}, high: ${s.high}, medium: ${s.medium}.`);
    lines.push("");
    lines.push(`_${e.secretHygiene.note}_`);
  }
  lines.push("");

  lines.push("## Re-sweep trail");
  lines.push("");
  lines.push("| Date | Ref | Grade |");
  lines.push("|---|---|---|");
  for (const t of e.reSweepTrail) {
    lines.push(`| ${t.date} | ${t.ref ?? "—"} | ${t.grade} |`);
  }
  lines.push("");

  lines.push("## SBOM");
  lines.push("");
  lines.push(
    e.sbom.included
      ? `Included: \`sbom.cdx.json\` + \`sbom.spdx.json\` (${e.sbom.formats}).`
      : `Not included — ${e.sbom.note}`,
  );
  lines.push("");

  return lines.join("\n");
}

/** The files that make up the evidence pack (before zipping). */
export function collectEvidenceFiles(session: Session): EvidenceFile[] {
  const latest = session.snapshots[session.snapshots.length - 1];
  const evidence = buildEvidenceObject(session);

  const files: EvidenceFile[] = [
    { name: "evidence.json", content: JSON.stringify(evidence, null, 2) },
    { name: "SUMMARY.md", content: buildSummaryMarkdown(evidence) },
  ];

  const cdx = generateSbom(latest, "cyclonedx");
  const spdx = generateSbom(latest, "spdx");
  if (cdx) files.push({ name: "sbom.cdx.json", content: cdx.body });
  if (spdx) files.push({ name: "sbom.spdx.json", content: spdx.body });

  return files;
}

/** Base filename (no extension) for the downloaded zip. */
export function evidenceBaseName(session: Session): string {
  const latest = session.snapshots[session.snapshots.length - 1];
  const date = latest.fetchedAt.slice(0, 10); // YYYY-MM-DD
  return `codetrawl-evidence-${repoSlug(latest.repo.fullName)}-${date}`;
}
