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
import { buildCoverageReport } from "../coverage";
import { assemble, type Brief, type BriefItem } from "./types";

/** Where an item sits in the answer.
 *
 *  `fix` is reserved for things with a named, external corroborator — a CVE, an
 *  advisory, a literal secret match. `investigate` is for what we found but
 *  cannot corroborate. The split is the product's whole claim, so nothing may
 *  cross it for emphasis. */
type BriefTier = "fix" | "investigate" | "hygiene";

type TieredItem = BriefItem & { tier: BriefTier };

export function buildSecurityBrief(
  snap: AnalysisSnapshot,
  sessionId: string,
): Brief {
  const base = `/session/${sessionId}`;
  const items: TieredItem[] = [];

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
      soWhat: `A password or key is written directly in your code, where anyone with the repo can read it.`,
      title: `${f.patternLabel} in ${f.filePath}`,
      evidence: `Line ${f.line}, matched as ${f.preview}. Deleting the line is not enough — it stays in git history, so the key has to be replaced at the service that issued it.`,
      href: `${base}/security`,
    });
  }

  for (const health of getDependencyHealths(snap)) {
    for (const v of health.vulnerable) {
      items.push({
        id: `vuln:${health.ecosystem}:${v.name}`,
        tier: "fix",
        soWhat: `A package you install has a publicly known security flaw. Updating it is usually the whole fix.`,
        title: `${v.name} ${v.current}`,
        evidence: `${v.cves.length} published security ${v.cves.length === 1 ? "advisory" : "advisories"} for this exact version: ${v.cves.join(", ")}. From ${health.ecosystem}${v.scope ? `, ${v.scope} dependency` : ""}.`,
        href: `${base}/packages`,
      });
    }
  }

  for (const m of findIncidentMatches(snap)) {
    items.push({
      id: `incident:${m.incident.id}`,
      tier: "fix",
      soWhat: `You may be using a version of a package that was tampered with in a known attack.`,
      title: `Possible match — ${m.incident.name}`,
      evidence: `${m.matchedPackages.join(", ")} match versions from that incident. Check the linked advisory before assuming the worst — a version match is not proof.`,
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
      soWhat: `Something outside your app can reach a line that runs commands or code. Worth reading closely.`,
      title: `${s.ruleId} in ${s.filePath}`,
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
      soWhat: `This line runs text as code. That is fine if the text is yours, and a problem if a user can influence it.`,
      title: `${f.patternName} in ${f.filePath}`,
      evidence: `Line ${f.line}: ${f.snippet}. We found the pattern; we did not check where the text comes from — so this is a question, not a finding.`,
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
      soWhat: `Lines that run commands or code, where we could not work out whether anything outside can reach them.`,
      title: `${unproven.length} risky ${unproven.length === 1 ? "line" : "lines"} we could not trace`,
      evidence:
        "We could not follow a route to them from any way into the app. That is not the same as saying nothing can get there — usually the route runs through code we cannot follow.",
      href: `${base}/security`,
    });
  }

  // --- hygiene: real, but not a security finding -------------------------

  for (const health of getDependencyHealths(snap)) {
    if (health.deprecated.length > 0) {
      items.push({
        id: `deprecated:${health.ecosystem}`,
        tier: "hygiene",
        soWhat: `The people who made these packages have stopped maintaining them. Nothing breaks today; nothing gets fixed either.`,
        title: `${health.deprecated.length} abandoned ${health.deprecated.length === 1 ? "package" : "packages"} (${health.ecosystem})`,
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
        soWhat: `Behind on updates. Not dangerous by itself, but the longer you leave it the harder the eventual upgrade.`,
        title: `${health.outdated.length} outdated ${health.outdated.length === 1 ? "package" : "packages"} (${health.ecosystem})`,
        evidence: `The furthest behind is ${worst.name}, ${worst.ageMonths} months older than the current ${worst.latest}.`,
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

  const tier = (t: BriefTier) => items.filter((i) => i.tier === t).map(({ tier: _t, ...rest }) => rest);

  return assemble(
    "security",
    "Composed from the Security, Packages and Signals tabs — nothing here is computed for this page. What CodeTrawl could not check is part of the answer rather than a footnote.",
    [
      {
        id: "fix",
        label: "Fix first",
        note: "Each of these has a named corroborator — an advisory, an incident, or a literal match.",
        items: tier("fix"),
      },
      {
        id: "investigate",
        label: "Worth a look",
        note: "Found, but not corroborated. A pattern match is a question, not a verdict.",
        items: tier("investigate"),
      },
      {
        id: "hygiene",
        label: "Dependency hygiene",
        note: "Real, and not a security finding.",
        items: tier("hygiene"),
      },
    ],
    gaps,
    {
      headline: "Nothing outstanding, and nothing went unchecked.",
      detail:
        "Your packages were checked against the public advisory databases, your code was scanned for keys and for lines that run commands, and nothing was blocked. Refresh the session to run it all again.",
    },
    answerFor(tier("fix").length, tier("investigate").length, gaps),
  );
}

/** The answer, from the same counts the sections were built from. */
function answerFor(
  fix: number,
  investigate: number,
  gaps: { kind: string }[],
): { answer: string; howToRead: string } {
  if (fix + investigate === 0 && gaps.some((g) => g.kind === "blocking")) {
    return {
      // The one that matters most. Nothing was found AND nothing looked, and
      // those must never read the same.
      answer: "We could not answer this one.",
      howToRead:
        "Nothing was found — but the checks that would have found it never ran. What stopped them is at the bottom of the page.",
    };
  }
  if (fix > 0) {
    return {
      answer: `${fix} thing${fix === 1 ? "" : "s"} here ${fix === 1 ? "has" : "have"} a known, published problem.`,
      howToRead:
        "Start at the top. Everything under \u201CFix first\u201D was matched against a public advisory or found literally in your code — it is not a guess. Each row links to the evidence.",
    };
  }
  if (investigate > 0) {
    return {
      answer: "Nothing confirmed, but a few things are worth a look.",
      howToRead:
        "Nothing matched a known vulnerability. What is below is code we noticed but cannot judge for you — mostly lines that run text as code, which is fine until a user can influence the text.",
    };
  }
  return {
    answer: "Nothing outstanding.",
    howToRead:
      "Your packages were checked against the public advisory databases and your code was scanned for keys and risky calls.",
  };
}
