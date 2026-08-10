// What the security page says it did, versus what it did.
//
// This page is the product's whole claim in one screen, so the failure mode
// that matters here is not a missed finding — it is a sentence that sounds like
// a result and is not one. Two were:
//
//   "0 of 10 matched"  rendered whenever findIncidentMatches came back empty,
//                      including when it returned before touching a single
//                      incident because there was nothing to compare. A Go repo
//                      (no dependency reader) and an npm repo with entirely
//                      healthy dependencies both got a confident denominator
//                      for a comparison that never ran. The healthier the repo,
//                      the more misleading the sentence.
//
//   "reported only where a path from an entry point can be shown"
//                      contradicted by the rollup one screen above it, which
//                      says "N more listed below without a traced path", and by
//                      secrets / patterns / incidents, which have no path
//                      concept at all.
//
// The count is asserted behaviourally against real snapshots. The copy is
// asserted against the source, because it is copy — but the assertions name the
// exact phrasings, so "we reworded it" cannot quietly restore the claim.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { AnalysisSnapshot } from "../types";
import {
  comparablePackageCount,
  findIncidentMatches,
} from "../security/knownIncidents";
import { loadSnapshot } from "./helpers/sessionFixture";
import { securityGapsShown } from "@/components/views/security/FindingsList";

const session = (id: string): AnalysisSnapshot => loadSnapshot<AnalysisSnapshot>(id);

const panelSrc = readFileSync(
  path.join(process.cwd(), "components", "views", "security", "SecurityPanel.tsx"),
  "utf-8",
);

describe("a comparison that did not run is not reported as a clean result", () => {
  it("counts zero comparable packages on a repo whose ecosystem we do not read", () => {
    // gin-gonic/gin declares its dependencies in go.mod. There is no Go
    // ecosystem plugin, so nothing was ever handed to the incident walker.
    const snap = session("gx1lLA07kO");
    expect(comparablePackageCount(snap)).toBe(0);
    expect(findIncidentMatches(snap)).toEqual([]);
  });

  it("counts zero when every dependency is current, too", () => {
    // The subtler half. packagesFromSnapshot only collects outdated, vulnerable
    // and deprecated entries — a fully up-to-date npm repo contributes nothing,
    // and used to be told "0 of 10 matched".
    const healthy = {
      dependencyHealths: [
        {
          ecosystem: "npm",
          total: 96,
          outdated: [],
          vulnerable: [],
          deprecated: [],
        },
      ],
    } as unknown as AnalysisSnapshot;
    expect(comparablePackageCount(healthy)).toBe(0);
    expect(findIncidentMatches(healthy)).toEqual([]);
  });

  it("counts the packages that really were compared", () => {
    const compared = {
      dependencyHealths: [
        {
          ecosystem: "npm",
          total: 3,
          outdated: [{ name: "left-pad", current: "1.0.0" }],
          vulnerable: [{ name: "lodash", current: "4.17.4", cves: ["CVE-1"] }],
          deprecated: [{ name: "request", current: "2.88.0" }],
        },
      ],
    } as unknown as AnalysisSnapshot;
    expect(comparablePackageCount(compared)).toBe(3);
  });

  it("agrees with the real snapshots the panel renders", () => {
    // Whatever the number is, "we compared N packages" and "we found no match"
    // must never both be claimed when N is 0.
    for (const id of ["gx1lLA07kO", "yAwwHY_ShB", "DBtU3d_Gfk", "o5QTmaYTwE"]) {
      const snap = session(id);
      const n = comparablePackageCount(snap);
      if (n === 0) {
        expect(findIncidentMatches(snap), `${id} matched with nothing to match`).toEqual(
          [],
        );
      }
    }
  });
});

describe("the incidents tile distinguishes the three answers", () => {
  it("has a not-scanned branch keyed on the comparable count", () => {
    expect(panelSrc).toContain("comparablePackageCount(snapshot)");
    expect(panelSrc).toMatch(/comparablePackages === 0\s*\n?\s*\?\s*"not-scanned"/);
  });

  it("says why nothing was scanned, rather than only that nothing was", () => {
    expect(panelSrc).toContain('notScannedLabel: "no packages to compare"');
  });

  it("states the denominator AND the numerator it compared against", () => {
    // "0 of 10 matched" alone is a claim about the incident list. What the
    // reader needs is what it was compared TO.
    expect(panelSrc).toMatch(/0 of \$\{KNOWN_INCIDENTS\.length\} matched across/);
    expect(panelSrc).toContain("${comparablePackages} package");
  });
});

describe("the scope note does not claim more rigour than the page shows", () => {
  it("no longer says findings are reported only where a path can be shown", () => {
    expect(
      panelSrc,
      "the page lists untraced findings — this sentence says it does not",
    ).not.toContain("only where a path from an entry point can be shown");
  });

  it("says the opposite, in the reader's words", () => {
    // Whitespace-tolerant: JSX line-wraps prose, so a contiguous-substring
    // assertion would fail on a reflow rather than on a changed claim.
    expect(panelSrc).toMatch(/Everything\s+found is listed/);
    expect(panelSrc).toMatch(/many are listed without one/);
  });

  it("keeps the standing line that unproven is not unreachable", () => {
    // The distinction the four reachability states exist for. Dropping the
    // overclaim must not turn into implying the untraced ones are safe.
    expect(panelSrc).toMatch(
      /we could not follow the route, not that nothing can reach it/,
    );
  });

  it("still keeps the rollup's own honest sentence, which contradicted it", () => {
    expect(panelSrc).toContain("more listed below without a traced path");
  });

  it("keeps the untouched-classes disclosure intact", () => {
    // The rewrite is about one clause. The rest of the note is the strongest
    // honesty on the page and must survive edits to its neighbour.
    expect(panelSrc).toContain("These four scanners are not a security review");
    expect(panelSrc).toMatch(/outnumber the ones we report roughly two to one/);
  });
});

describe("the empty-findings card names what was not checked", () => {
  // c68004a took the green tick off the tiles. The same claim survived twenty
  // inches further down the page: an empty findings list rendered a ShieldCheck
  // and "The deterministic scanners ran on this snapshot and surfaced nothing
  // actionable" — gated on `unchecked.none` alone, so it fired on a page that
  // was simultaneously showing NOT SCANNED pills.
  //
  // Two live shapes. All 22 stored sessions lack sinkFindings and 20 lack
  // riskyPatternFindings, so a clean JS/TS repo hit it every time. And no stored
  // session is mixed-language, which is why the rule is tested here as a
  // function rather than asserted from a screenshot.

  it("carries the scanners that produced no data", () => {
    expect(securityGapsShown(null, ["code paths", "patterns"])).toEqual([
      "code paths",
      "patterns",
    ]);
  });

  it("carries a language with no rules even when another language had them", () => {
    // `none === false` is the mixed case: JS got rules, Java did not. The old
    // condition treated it as fully checked.
    const gaps = securityGapsShown(
      { plugins: ["java"], files: 210, none: false },
      [],
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain("java");
    expect(gaps[0]).toContain("no rules for it");
  });

  it("pluralises when several languages went unruled", () => {
    const gaps = securityGapsShown(
      { plugins: ["java", "go"], files: 400, none: false },
      [],
    );
    expect(gaps[0]).toContain("java + go");
    expect(gaps[0]).toContain("no rules for them");
  });

  it("does not repeat the no-rules-at-all case, which has its own paragraph", () => {
    // `none === true` gets the fuller explanation above; listing it here would
    // say the same thing twice in two voices.
    expect(securityGapsShown({ plugins: ["go"], files: 99, none: true }, [])).toEqual(
      [],
    );
  });

  it("is empty only when everything really did run", () => {
    expect(securityGapsShown(null, [])).toEqual([]);
    expect(securityGapsShown(undefined, [])).toEqual([]);
  });

  it("keeps the confident sentence behind that emptiness", () => {
    const src = readFileSync(
      path.join(process.cwd(), "components", "views", "security", "FindingsList.tsx"),
      "utf-8",
    );
    // The claim may still exist — it is true when nothing is missing. What must
    // not exist is a path to it that skips the check.
    expect(src).toContain("The deterministic scanners ran on this snapshot");
    expect(src).toMatch(/gapsHere\.length > 0/);
    expect(src, "the honest branch must come first").toMatch(
      /gapsHere\.length > 0 \? \(/,
    );
  });

  it("hands the card the same list the rollup line prints", () => {
    // The contradiction was two components deriving "what is missing"
    // independently. One list, passed down.
    const panel = readFileSync(
      path.join(process.cwd(), "components", "views", "security", "SecurityPanel.tsx"),
      "utf-8",
    );
    expect(panel).toContain("notScanned={notScanned}");
    expect(panel).toMatch(/notScanned\.join\(" \+ "\)/);
  });
});
