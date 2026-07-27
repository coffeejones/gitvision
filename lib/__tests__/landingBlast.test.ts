// The landing's blast diagram is a RENDERING of the Faultline canvas.
//
// Same argument as the code pane: a screenshot at least fails visibly when the
// product moves, while a hand-tuned imitation keeps looking plausible after it
// has stopped being true. This is also the shot that carried an unstyled white
// React Flow panel for weeks precisely because nobody re-examines a picture.
//
// Two things are pinned. The LAYOUT must equal FaultlineBlastCanvas's, and the
// BLAST must be the analyzer's — the fixture may choose which file to blow up,
// never how many things break.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { LANDING_BLAST, blastCounts } from "../landingBlast";

const read = (...p: string[]) =>
  readFileSync(path.join(process.cwd(), ...p), "utf-8");

const diagram = read("components", "landing", "codetrawl", "CTBlastDiagram.tsx");
const canvas = read("components", "views", "FaultlineBlastCanvas.tsx");

function constOf(src: string, name: string): number {
  const m = src.match(new RegExp(`const ${name} = ([0-9.]+)`));
  if (!m) throw new Error(`${name} not found`);
  return Number(m[1]);
}

describe("the diagram uses the canvas's layout", () => {
  for (const name of ["COL_W", "ROW_H", "ROWS_PER_COL"]) {
    it(`${name} equals the canvas's`, () => {
      expect(constOf(diagram, name)).toBe(constOf(canvas, name));
    });
  }

  it("draws the casualty card at the canvas's size", () => {
    // The canvas sets these inline on AffectedNode: width 208, minHeight 56.
    expect(canvas).toMatch(/width: 208/);
    expect(canvas).toMatch(/minHeight: 56/);
    expect(constOf(diagram, "CARD_W")).toBe(208);
    expect(constOf(diagram, "CARD_H")).toBe(56);
  });

  it("marks an untested casualty the way the canvas does", () => {
    // A 4px inset stripe in rose is the canvas's signature for "no test".
    expect(canvas).toMatch(/inset 4px 0 0 \$\{TOK\.rose\}/);
    expect(diagram).toMatch(/width=\{4\}/);
    expect(diagram).toContain("ROSE");
  });

  it("ships as SVG, not as a client canvas", () => {
    // Importing React Flow here would pull the whole library onto the landing
    // for a picture that never pans or zooms.
    expect(diagram).not.toContain("@xyflow/react");
    expect(diagram).not.toContain('"use client"');
    expect(diagram).toContain("<svg");
  });
});

describe("the blast is computed, not composed", () => {
  it("records how it was derived", () => {
    expect(LANDING_BLAST.provenance).toMatch(/computeBlastRadius/);
    expect(LANDING_BLAST.provenance).toMatch(/session/i);
  });

  it("stays at one hop, which the headline depends on", () => {
    // The product is deliberately hop-1 for this count: a hop-2 file imports
    // the broken file, not the deleted one, so it does not necessarily break.
    // Widening this without changing the wording would make "N files break" a
    // claim we cannot defend.
    expect(LANDING_BLAST.hops).toBe(1);
    expect(diagram).toContain("direct importers only");
  });

  it("derives the headline counts instead of restating them", () => {
    // A hand-typed total is the first thing to drift when a casualty is added.
    const { breaks, untested } = blastCounts();
    expect(breaks).toBe(LANDING_BLAST.casualties.length);
    expect(untested).toBe(
      LANDING_BLAST.casualties.filter((c) => c.untested).length,
    );
    expect(diagram).toContain("blastCounts()");
    // No literal count anywhere in the component.
    expect(diagram).not.toMatch(/breaks \d+ files/);
  });

  it("shows the covered casualties too", () => {
    // The chosen blast has three files a test does reach. Rendering only the
    // untested ones would be the advertisement version of this diagram.
    const covered = LANDING_BLAST.casualties.filter((c) => !c.untested);
    expect(covered.length).toBeGreaterThan(0);
    expect(diagram).toContain("COVERED");
  });

  it("orders casualties untested-first, as the product does", () => {
    // computeAffectedFiles sorts by hop, then untested, then path — so the
    // diagram's reading order is the product's risk order.
    const flags = LANDING_BLAST.casualties.map((c) => c.untested);
    const firstCovered = flags.indexOf(false);
    if (firstCovered !== -1) {
      expect(
        flags.slice(firstCovered).every((f) => f === false),
        "an untested casualty appears after a covered one",
      ).toBe(true);
    }
  });

  it("names real files, with no duplicates", () => {
    const paths = LANDING_BLAST.casualties.map((c) => c.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of paths) expect(p).toMatch(/^[\w().\-/[\]]+\.(ts|tsx)$/);
    expect(LANDING_BLAST.epicenter).toMatch(/\.tsx?$/);
    expect(paths).not.toContain(LANDING_BLAST.epicenter);
  });

  it("fits the three columns the layout draws", () => {
    // 6 rows per column; more than 18 casualties would need a fourth column and
    // a wider viewBox than the section gives it.
    const cols = Math.ceil(
      LANDING_BLAST.casualties.length / constOf(diagram, "ROWS_PER_COL"),
    );
    expect(cols).toBeLessThanOrEqual(3);
  });
});
