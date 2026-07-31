// The landing's Security shot is the product's own SecurityPanel, mounted.
//
// That makes most of the usual guards unnecessary: the scanner states, the
// count labels, the incident subtitle and the severity ordering are computed by
// the panel at render time, so they cannot drift from the product the way the
// redrawn panes did. What CAN still go wrong is the INPUT — someone edits a
// finding to look tidier, or trims the dependency list and turns a passing
// check into a vacuous one. Those are what this file watches.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { findIncidentMatches, KNOWN_INCIDENTS } from "../security/knownIncidents";
import {
  LANDING_SECURITY_SNAPSHOT as SNAP,
  LANDING_SECURITY_SESSION_ID,
  LANDING_SECURITY_PROVENANCE,
} from "../landingSecurity";
import { DEMO_SESSIONS } from "../demoSessions";

const read = (...p: string[]) =>
  readFileSync(path.join(process.cwd(), ...p), "utf-8");

const pane = read("components", "landing", "codetrawl", "CTSecurityPane.tsx");

describe("the shot mounts the product, it does not redraw it", () => {
  it("renders the real SecurityPanel", () => {
    expect(pane).toMatch(
      /import \{ SecurityPanel \} from "@\/components\/views\/security\/SecurityPanel"/,
    );
    expect(pane).toContain("<SecurityPanel");
  });

  it("does not re-derive anything the panel derives", () => {
    // The moment the landing computes a scanner state or a count label itself,
    // it owns a copy that can drift — which is the whole failure this arc has
    // been undoing. The panel gets a snapshot and nothing else.
    //
    // Comments are stripped first: the file explains WHY those strings belong
    // to the panel, and naming them there is the point.
    const code = pane
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    for (const owned of ["not-scanned", "curated supply-chain attacks", "findings.length"]) {
      expect(code, `the pane re-derives "${owned}"`).not.toContain(owned);
    }
  });

  it("re-points the font variables the panel styles through", () => {
    // FindingsList uses Tailwind's font-mono, i.e. --font-mono, which the .ct
    // scope never sets — without this the file paths render in Geist Mono while
    // every other mono line on the page is the CodeTrawl face.
    expect(pane).toMatch(/"--font-mono": "var\(--font-ct-mono\)"/);
  });

  it("points the findings' links at a real demo session", () => {
    // Every row links into /session/<id>/…; an id that is not a public demo
    // would send a visitor to a 404 or a sign-in wall.
    expect(DEMO_SESSIONS.map((d) => d.sessionId)).toContain(LANDING_SECURITY_SESSION_ID);
  });
});

describe("the pinned sweep is a real one", () => {
  it("records how it was derived", () => {
    expect(LANDING_SECURITY_PROVENANCE).toMatch(/analyzeRepo/);
    // A date, not one specific date. The first version pinned 2026-07-27 and
    // then failed the moment the fixture was legitimately re-swept — a guard
    // that fires on the correct action is worse than none, because the fix is
    // to edit the test.
    expect(LANDING_SECURITY_PROVENANCE).toMatch(/\b20\d{2}-\d{2}-\d{2}\b/);
    // The snapshot must be from the sweep the provenance names, not a mixture:
    // re-pinning only the new field while leaving last week's star count is
    // exactly the drift this file warns about.
    const [date] = LANDING_SECURITY_PROVENANCE.match(/\b20\d{2}-\d{2}-\d{2}\b/)!;
    expect(SNAP.fetchedAt.startsWith(date), "fixture mixes two sweeps").toBe(true);
  });

  it("shows Incidents clean because the check RAN, not because it was empty", () => {
    // This is the one that matters. findIncidentMatches reads outdated +
    // vulnerable + deprecated; with those lists emptied the card would still
    // say "Clean", but it would mean "nothing was checked" while looking
    // exactly like "nothing was found".
    const checked = [
      ...SNAP.dependencyHealths![0].outdated,
      ...SNAP.dependencyHealths![0].vulnerable,
      ...SNAP.dependencyHealths![0].deprecated,
    ];
    expect(checked.length).toBeGreaterThan(20);
    expect(KNOWN_INCIDENTS.length).toBeGreaterThan(0);
    expect(findIncidentMatches(SNAP)).toEqual([]);
  });

  it("keeps the vulnerable packages as vulnerable", () => {
    // An earlier draft folded these into `outdated` with a fabricated `latest`
    // to keep the fixture short. Eleven advisories across three dev-scope
    // packages is a true fact about this sweep; the snapshot says so.
    const vuln = SNAP.dependencyHealths![0].vulnerable;
    expect(vuln.map((v) => v.name).sort()).toEqual(["click", "jinja2", "werkzeug"]);
    expect(vuln.reduce((n, v) => n + v.cves.length, 0)).toBe(11);
  });

  it("distinguishes scanned-and-clean from never-scanned", () => {
    // secretFindings === undefined renders "Not scanned"; an empty findings
    // array with a real filesScanned renders "Clean". They are different
    // claims and the shot makes the stronger one.
    expect(SNAP.secretFindings).toBeDefined();
    expect(SNAP.secretFindings!.findings).toEqual([]);
    expect(SNAP.secretFindings!.filesScanned).toBeGreaterThan(0);
  });

  it("has no scanner in the not-scanned state at all", () => {
    // The test above pinned that property for ONE field, and the failure it
    // describes then happened to a different one: the reachability engine
    // shipped, this fixture predated it, sinkFindings was absent, and
    // SecurityPanel put "code paths not scanned" at the top of the landing's
    // security shot — the flagship scanner advertised as one that never ran.
    //
    // So assert the class, not the instance. SecurityPanel maps `undefined` to
    // "not-scanned" for each of these, and this list is every field it reads
    // that way. Add a scanner and the shot must be re-swept, or this fails.
    const scanners: [string, unknown][] = [
      ["secrets", SNAP.secretFindings],
      ["patterns", SNAP.riskyPatternFindings],
      ["code paths", SNAP.sinkFindings],
    ];
    const notScanned = scanners.filter(([, v]) => v === undefined).map(([n]) => n);
    expect(notScanned, "the landing shot advertises a scanner as not run").toEqual([]);

    // And the panel must still read every one of them, or the assertion above
    // is checking fields nothing renders.
    const panel = read("components", "views", "security", "SecurityPanel.tsx");
    for (const field of ["secretFindings", "riskyPatternFindings", "sinkFindings"]) {
      expect(panel, `${field} is no longer read by the panel`).toContain(field);
    }
  });

  it("keeps the engine's own reachability verdict, unsoftened", () => {
    // Four tainted sinks and NONE reachable is the honest answer for a
    // framework with no application routes of its own. A fixture edited to
    // show a reachable finding would be the fake version of the one panel
    // whose claim is that reachability is computed rather than assumed.
    const r = SNAP.sinkFindings!;
    expect(r.total).toBe(r.findings.length);
    expect(r.tainted).toBe(r.findings.filter((f) => f.taint).length);
    expect(r.counts.reachable).toBe(0);
    expect(r.findings.every((f) => f.reachability !== "reachable")).toBe(true);
  });

  it("shows a real interprocedural flow, not a bare line number", () => {
    // The whole difference between this engine and the pattern scanner it sits
    // beside: os.environ reaches exec() through from_envvar -> from_pyfile.
    // Losing the hops would quietly turn the shot back into "there is an exec
    // on line 209".
    const withHops = SNAP.sinkFindings!.findings.filter(
      (f) => (f.taint?.hops?.length ?? 0) > 0,
    );
    expect(withHops.length).toBeGreaterThan(0);
    expect(withHops[0].taint!.source).toBe("os.environ");
    expect(withHops[0].taint!.hops!.map((h) => h.name)).toEqual([
      "from_envvar",
      "from_pyfile",
    ]);
  });

  it("carries the two patterns the sweep actually found", () => {
    const f = SNAP.riskyPatternFindings!.findings;
    expect(f).toHaveLength(2);
    expect(f.map((x) => `${x.filePath}:${x.line}`)).toEqual([
      "src/flask/cli.py:1023",
      "src/flask/config.py:209",
    ]);
    // Real source lines, not paraphrases — the excerpt is evidence.
    expect(f[0].snippet).toContain("eval(compile(");
    expect(f[1].snippet).toContain("exec(compile(");
  });
});
