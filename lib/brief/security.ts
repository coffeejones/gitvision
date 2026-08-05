// "Is this safe to depend on?" — the security question, answered once.
//
// The answer already exists, spread across three tabs. Secrets, dangerous
// calls and eval patterns live on Security; vulnerable packages and their CVEs
// live on Packages; known supply-chain incidents and broad CI permissions are
// rows in the Signals list. A reader who wants to know whether a repo is safe
// has to visit all three and hold the result in their head.
//
// This composes them into one ordered answer. It computes NOTHING new: every
// item below is a field already on the snapshot, and every item carries a deep
// link back to the surface that owns it, because a brief that cannot be
// audited is just a summary.
//
// THE COVERAGE GAPS ARE PART OF THE ANSWER, NOT A FOOTNOTE. A Go repo has no
// dependency reader and no dangerous-call rules, so its "nothing found" is the
// silence of a scanner that never ran. Composing the findings without that
// context would take three tabs' worth of ambiguity and turn it into one
// confident, wrong sentence — which is worse than the tabs.

import type { AnalysisSnapshot } from "../types";
import { getDependencyHealths } from "../signals";
import { findIncidentMatches } from "../security/knownIncidents";
import { buildCoverageReport, type CoverageGap } from "../coverage";

/** Where an item sits in the answer.
 *
 *  `fix` is reserved for things with a named, external corroborator — a CVE, an
 *  advisory, a literal secret match. `investigate` is for what we found but
 *  cannot corroborate. The split is the product's whole claim, so nothing may
 *  cross it for emphasis. */
export type BriefTier = "fix" | "investigate" | "hygiene";

export interface BriefItem {
  /** Stable id, for keys and for tests that pin ordering. */
  id: string;
  tier: BriefTier;
  title: string;
  /** The concrete fact behind the title. Never a paraphrase. */
  evidence: string;
  /** Deep link to the surface that owns this finding. */
  href: string;
}

export interface SecurityBrief {
  items: BriefItem[];
  /** The recorded blind spots that bear on this question. */
  gaps: CoverageGap[];
  /** True only when we found nothing AND nothing stopped us looking. With any
   *  blocking gap present this stays false, because "clean" would be a claim we
   *  did not earn. */
  clean: boolean;
}

function tierOf(items: BriefItem[], tier: BriefTier): BriefItem[] {
  return items.filter((i) => i.tier === tier);
}

export function buildSecurityBrief(
  snap: AnalysisSnapshot,
  sessionId: string,
): SecurityBrief {
  const base = `/session/${sessionId}`;
  const items: BriefItem[] = [];

  // --- fix first: findings with an external corroborator -----------------

  // Secrets are not HealthSignal-shaped, so they are read straight off the
  // snapshot — the same way SecurityPanel does.
  // Indexed, not keyed on file+line: one line can carry two matches, and a
  // collision here makes React drop a finding without a word. Measured on a
  // real session — two eval() patterns on CTShowcaseMocks.tsx:214.
  for (const [i, f] of (snap.secretFindings?.findings ?? []).entries()) {
    items.push({
      id: `secret:${i}:${f.filePath}:${f.line}`,
      tier: "fix",
      title: `${f.patternLabel} in ${f.filePath}`,
      evidence: `Line ${f.line}, matched as ${f.preview}. Rotate it before anything else — the value is in git history whatever you do to the file now.`,
      href: `${base}/security`,
    });
  }

  for (const health of getDependencyHealths(snap)) {
    for (const v of health.vulnerable) {
      items.push({
        id: `vuln:${health.ecosystem}:${v.name}`,
        tier: "fix",
        title: `${v.name} ${v.current} has ${v.cves.length === 1 ? "an advisory" : `${v.cves.length} advisories`}`,
        evidence: `${v.cves.join(", ")} — ${health.ecosystem}${v.scope ? `, ${v.scope} scope` : ""}.`,
        href: `${base}/packages`,
      });
    }
  }

  for (const m of findIncidentMatches(snap)) {
    items.push({
      id: `incident:${m.incident.id}`,
      tier: "fix",
      title: `Possible match — ${m.incident.name}`,
      evidence: `${m.matchedPackages.join(", ")}. Verify against the advisory before treating it as a confirmed compromise.`,
      href: `${base}/security`,
    });
  }

  // A sink with a traced path from an entry point is the one code-path finding
  // that belongs beside a CVE. Everything else the scanner produced is below.
  for (const [i, s] of (snap.sinkFindings?.findings ?? []).entries()) {
    if (s.reachability !== "reachable") continue;
    items.push({
      id: `sink:${i}:${s.filePath}:${s.line}`,
      tier: "fix",
      title: `${s.ruleId} reachable in ${s.filePath}`,
      evidence: s.path
        ? `Traced from ${s.path.entry.name}${s.path.hops.length > 1 ? ` through ${s.path.hops.length - 1} more` : ""} to line ${s.line}. Reachable from an entry point — not proof it runs on every request.`
        : `Line ${s.line}, reachable from an entry point.`,
      href: `${base}/security`,
    });
  }

  // --- investigate: found, not corroborated ------------------------------

  // The line this product does not cross. riskyPatterns.ts says so in its own
  // header: it flags occurrences as "worth reviewing", never as malicious, and
  // it does not track whether the argument is dynamic. A pattern is a question.
  for (const [i, f] of (snap.riskyPatternFindings?.findings ?? []).entries()) {
    items.push({
      id: `pattern:${i}:${f.filePath}:${f.line}`,
      tier: "investigate",
      title: `${f.patternName} in ${f.filePath}`,
      evidence: `Line ${f.line}: ${f.snippet}. A pattern match, not a vulnerability — CodeTrawl does not track whether the argument is attacker-controlled.`,
      href: `${base}/security`,
    });
  }

  const unproven = (snap.sinkFindings?.findings ?? []).filter(
    (s) => s.reachability !== "reachable",
  );
  if (unproven.length > 0) {
    items.push({
      id: "sinks:unproven",
      tier: "investigate",
      title: `${unproven.length} dangerous ${unproven.length === 1 ? "call" : "calls"} with no traced path`,
      evidence:
        "Found, but no route from an entry point was proven. Unproven is not the same as unreachable — it usually means the path runs through code the resolver could not follow.",
      href: `${base}/security`,
    });
  }

  // --- hygiene: real, but not a security finding -------------------------

  for (const health of getDependencyHealths(snap)) {
    if (health.deprecated.length > 0) {
      items.push({
        id: `deprecated:${health.ecosystem}`,
        tier: "hygiene",
        title: `${health.deprecated.length} deprecated ${health.deprecated.length === 1 ? "package" : "packages"} (${health.ecosystem})`,
        evidence: health.deprecated
          .slice(0, 3)
          .map((d) => d.name)
          .join(", "),
        href: `${base}/packages`,
      });
    }
    if (health.outdated.length > 0) {
      const worst = [...health.outdated].sort((a, b) => b.ageMonths - a.ageMonths)[0];
      items.push({
        id: `outdated:${health.ecosystem}`,
        tier: "hygiene",
        title: `${health.outdated.length} outdated ${health.outdated.length === 1 ? "package" : "packages"} (${health.ecosystem})`,
        evidence: `Oldest is ${worst.name} at ${worst.ageMonths} months behind ${worst.latest}.`,
        href: `${base}/packages`,
      });
    }
  }

  // The gaps that bear on THIS question. A narrowed scope or an unparsed
  // language changes what "nothing found" is worth here too, so they come along
  // — but a PR-window note does not, and is left on its own tab.
  const gaps = buildCoverageReport(snap).filter(
    (g) => g.surface === "security" || g.surface === "packages" || g.surface === "session",
  );

  return {
    items,
    gaps,
    // Not "no items". A blocking gap means something was never checked, and
    // calling that clean is the exact overclaim this whole arc exists to stop.
    clean: items.length === 0 && !gaps.some((g) => g.kind === "blocking"),
  };
}

export { tierOf };
