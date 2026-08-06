// One question, answered across three tabs — and the rules it must not bend.
//
// The brief composes findings that already exist on Security, Packages and
// Signals. Composition is the easy part. What makes it worth shipping is that
// it keeps two lines the tabs keep today and a summary would blur:
//
//   fix vs investigate — "fix" is reserved for findings with a NAMED external
//   corroborator: a CVE, a known incident, a literal secret match. A pattern
//   match is a question. lib/security/riskyPatterns.ts says so in its own
//   header ("worth reviewing", never malicious, and it does not track whether
//   the argument is attacker-controlled). Promoting one for emphasis would
//   sell the thing the product refuses to sell.
//
//   found-nothing vs looked-at-nothing — `clean` is false whenever a blocking
//   coverage gap is present. A Go repo has no dependency reader and no
//   dangerous-call rules, so its zeroes are silence, not safety. Measured:
//   gin-gonic/gin produces 0 items and 2 blocking gaps.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

import { hasSessions, loadSnapshot } from "./helpers/sessionFixture";
import path from "node:path";

import type { AnalysisSnapshot } from "../types";
import { buildSecurityBrief } from "../brief/security";

// Resolved through the shared helper: cwd first, then the main checkout, so
// this works from a git worktree. See helpers/sessionFixture.ts.

// These assert against REAL captured analyses — a synthetic graph would
// defeat the point — and the four total 61 MB, far too much to commit. A
// machine without them reports skipped rather than broken.
const HAVE = hasSessions("gx1lLA07kO", "yAwwHY_ShB", "o5QTmaYTwE", "DBtU3d_Gfk");
const session = (id: string): AnalysisSnapshot => loadSnapshot<AnalysisSnapshot>(id);

/** Items in one section. Sections with no items are dropped by assemble(), so
 *  an absent section and an empty one are the same thing here. */
const tier = (b: ReturnType<typeof buildSecurityBrief>, t: string) =>
  b.sections.find((s) => s.id === t)?.items ?? [];

/** Every item across every section. */
const allItems = (b: ReturnType<typeof buildSecurityBrief>) =>
  b.sections.flatMap((s) => s.items);

describe.skipIf(!HAVE)("what counts as 'fix first'", () => {
  it("puts a CVE-bearing package there, with the advisory ids", () => {
    const b = buildSecurityBrief(session("yAwwHY_ShB"), "s1");
    const fix = tier(b, "fix");
    expect(fix.length).toBeGreaterThan(0);
    // The evidence must carry the corroborator, not a paraphrase of it.
    expect(fix.some((i) => /GHSA-|CVE-/.test(i.evidence))).toBe(true);
    for (const item of fix) {
      expect(item.href, "a fix item with nowhere to verify it").toContain("/session/s1/");
    }
  });

  it("keeps a pattern match OUT of it", () => {
    // The line the product does not cross. An eval() occurrence is not a
    // vulnerability and must never be tiered as one.
    const snap = {
      riskyPatternFindings: {
        findings: [
          { filePath: "src/a.py", line: 12, patternName: "eval() call", snippet: "eval(x)" },
        ],
      },
    } as unknown as AnalysisSnapshot;
    const b = buildSecurityBrief(snap, "s1");
    expect(tier(b, "fix")).toEqual([]);
    const inv = tier(b, "investigate")[0];
    expect(tier(b, "investigate")).toHaveLength(1);
    // The line has to hold in BOTH sentences now. soWhat is the one a reader
    // without the vocabulary actually reads, so it is the easier one to cross:
    // "this line runs text as code" is true, "this is a vulnerability" is not.
    expect(inv.evidence).toContain("not a finding");
    expect(inv.soWhat).toMatch(/fine if|problem if/);
    expect(inv.soWhat.toLowerCase()).not.toContain("vulnerab");
  });

  it("keeps an unproven code path out of it too", () => {
    // Reachability is the claim. A sink with no traced route is a question,
    // and "unproven" is not the same as "unreachable" — the copy must say so.
    const snap = {
      sinkFindings: {
        findings: [
          { filePath: "a.py", line: 3, ruleId: "py-os-system", reachability: "unknown" },
          { filePath: "b.py", line: 9, ruleId: "py-eval", reachability: "unreachable" },
        ],
      },
    } as unknown as AnalysisSnapshot;
    const b = buildSecurityBrief(snap, "s1");
    expect(tier(b, "fix")).toEqual([]);
    const inv = tier(b, "investigate");
    expect(inv).toHaveLength(1);
    expect(inv[0].title).toContain("2 risky lines");
    expect(inv[0].evidence).toContain("not the same as saying nothing can get there");
    // And it must not promise safety in the plain sentence either.
    expect(inv[0].soWhat).toContain("could not work out");
  });

  it("promotes a sink only when a path was traced", () => {
    const snap = {
      sinkFindings: {
        findings: [
          {
            filePath: "app.py",
            line: 42,
            ruleId: "py-os-system",
            reachability: "reachable",
            path: { entry: { name: "handle_request" }, hops: [{}, {}] },
          },
        ],
      },
    } as unknown as AnalysisSnapshot;
    const fix = tier(buildSecurityBrief(snap, "s1"), "fix");
    expect(fix).toHaveLength(1);
    expect(fix[0].evidence).toContain("handle_request");
    // And it must not overclaim: reachable is not "runs every time".
    expect(fix[0].evidence).toContain("not proof it runs");
  });
});

describe.skipIf(!HAVE)("clean means we looked", () => {
  it("is false on a repo where nothing could be checked", () => {
    // gin-gonic/gin: 0 findings, 2 blocking gaps. The whole point.
    const b = buildSecurityBrief(session("gx1lLA07kO"), "s1");
    expect(allItems(b)).toEqual([]);
    expect(b.gaps.filter((g) => g.kind === "blocking").length).toBeGreaterThan(0);
    expect(b.clean, "a repo we could not check reported as clean").toBe(false);
  });

  it("is true only when there is nothing found AND nothing blocked", () => {
    const b = buildSecurityBrief(session("o5QTmaYTwE"), "s1");
    expect(allItems(b)).toEqual([]);
    expect(b.gaps).toEqual([]);
    expect(b.clean).toBe(true);
  });

  it("is false as soon as there is a finding, gaps or not", () => {
    const b = buildSecurityBrief(session("yAwwHY_ShB"), "s1");
    expect(allItems(b).length).toBeGreaterThan(0);
    expect(b.clean).toBe(false);
  });
});

describe.skipIf(!HAVE)("it composes rather than computes", () => {
  it("carries only gaps that bear on this question", () => {
    // A PR-window note is real, and belongs on the PRs tab. Dragging every gap
    // onto every brief is how the ones that matter stop being read.
    const b = buildSecurityBrief(session("gx1lLA07kO"), "s1");
    expect(b.gaps.map((g) => g.id)).not.toContain("pr-window");
  });

  it("gives every item somewhere to verify it", () => {
    for (const id of ["yAwwHY_ShB", "o5QTmaYTwE", "DBtU3d_Gfk"]) {
      for (const item of allItems(buildSecurityBrief(session(id), "s1"))) {
        expect(item.href, `${id}/${item.id}`).toMatch(/^\/session\/s1\/(security|packages)$/);
        expect(item.title.length, `${id}/${item.id} has no title`).toBeGreaterThan(5);
        expect(item.evidence, `${id}/${item.id} left a placeholder`).not.toMatch(
          /undefined|NaN|\[object/,
        );
      }
    }
  });

  it("is a pure function — same snapshot, same bytes", () => {
    const s = session("yAwwHY_ShB");
    expect(JSON.stringify(buildSecurityBrief(s, "s1"))).toBe(
      JSON.stringify(buildSecurityBrief(s, "s1")),
    );
  });

  it("gives every item a unique id", () => {
    // Two secrets on the same line of the same file would collide, and React
    // would silently render one. Cheap to assert, annoying to debug.
    for (const id of ["yAwwHY_ShB", "6xw0IjzqRh", "DBtU3d_Gfk"]) {
      const ids = allItems(buildSecurityBrief(session(id), "s1")).map((i) => i.id);
      expect(new Set(ids).size, `${id} has duplicate item ids`).toBe(ids.length);
    }
  });

  it("survives a snapshot with nothing on it", () => {
    // Old sessions on disk must keep rendering (AGENTS.md invariant 2).
    const empty = {} as unknown as AnalysisSnapshot;
    expect(() => buildSecurityBrief(empty, "s1")).not.toThrow();
    expect(allItems(buildSecurityBrief(empty, "s1"))).toEqual([]);
  });
});

describe("the route only serves subjects that exist", () => {
  it("validates against the registry rather than its own list", async () => {
    // The page used to carry its own SUBJECTS literal, which is how the second
    // and third questions could exist in lib/ and be unreachable from the UI.
    const src = readFileSync(
      path.join(process.cwd(), "app", "session", "[id]", "brief", "[subject]", "page.tsx"),
      "utf-8",
    );
    expect(src, "the page keeps a private subject list again").not.toContain("const SUBJECTS = {");
    expect(src).toContain("isSubjectId(subject)");
    expect(src, "an unknown subject must 404").toContain("notFound()");
  });
});
