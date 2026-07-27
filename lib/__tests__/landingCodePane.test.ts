// The landing's code pane is a RENDERING of the Source view, not a lookalike.
//
// That distinction is the whole justification for replacing a screenshot with
// markup. A screenshot at least fails visibly when the product moves — it looks
// dated. A hand-tuned imitation fails invisibly: it keeps looking plausible
// while quietly ceasing to be what the product does, which is the fake version
// of this idea wearing the honest one's clothes.
//
// So two things are pinned. The GEOMETRY must equal components/views/CodeView's
// (change it there, this fails). And the NUMBERS must be the analyzer's, not
// ours — the fixture may choose which function to show, never what is true
// about it.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { LANDING_SOURCE } from "../landingSource";

const read = (...p: string[]) =>
  readFileSync(path.join(process.cwd(), ...p), "utf-8");

const pane = read("components", "landing", "codetrawl", "CTCodePane.tsx");
const codeView = read("components", "views", "CodeView.tsx");

/** `const NAME = 123;` → 123 */
function constOf(src: string, name: string): number {
  const m = src.match(new RegExp(`const ${name} = ([0-9.]+)`));
  if (!m) throw new Error(`${name} not found`);
  return Number(m[1]);
}

describe("the landing pane matches the product's geometry", () => {
  for (const name of ["LINE_HEIGHT", "GUTTER_NUM", "GUTTER_MARK"]) {
    it(`${name} equals the Source view's`, () => {
      expect(constOf(pane, name)).toBe(constOf(codeView, name));
    });
  }

  it("uses the same code type size", () => {
    // CodeView carries it inline: `const mono = { ..., fontSize: 12.5 }`.
    const m = codeView.match(/fontFamily: "var\(--font-mono\)", fontSize: ([0-9.]+)/);
    expect(m, "CodeView's mono size moved — update the pane").not.toBeNull();
    expect(constOf(pane, "CODE_SIZE")).toBe(Number(m![1]));
  });

  it("renders the code with the same whitespace handling", () => {
    // Anything other than `pre` reflows code, which would make the pane a
    // picture OF code rather than code.
    expect(pane).toContain('whiteSpace: "pre"');
  });
});

describe("the landing pane shows the product's findings, not flattering ones", () => {
  it("uses the chip wording the product uses", () => {
    const aiReading = read("components", "views", "AiReading.tsx");
    for (const phrase of ["Complexity ", "Called from ", "No test guards it"]) {
      expect(aiReading, `the product no longer says "${phrase}"`).toContain(phrase);
      expect(pane, `the pane no longer says "${phrase}"`).toContain(phrase);
    }
    // The twin chip is built from a count in both places.
    expect(aiReading).toMatch(/twin\$\{/);
    expect(pane).toMatch(/twin\$\{/);
  });

  it("does not hide the unflattering chips behind a flag", () => {
    // The chosen example is complexity 8, duplicated once, and untested. If a
    // future edit renders only the neutral chips, the pane has become an
    // advertisement rather than a screenshot.
    expect(pane).toContain("duplicateCount > 0");
    expect(pane).toContain("!src.signals.fileTested");
  });

  it("keeps the fixture's signals in the shape the product computes", () => {
    const s = LANDING_SOURCE.signals;
    expect(Number.isInteger(s.complexity)).toBe(true);
    expect(s.complexity).toBeGreaterThan(0);
    expect(Number.isInteger(s.callerCount)).toBe(true);
    expect(s.duplicateCount).toBeGreaterThanOrEqual(0);
    expect(typeof s.fileTested).toBe("boolean");
  });

  it("records where the numbers came from", () => {
    // A figure with no provenance is indistinguishable from one we invented.
    expect(LANDING_SOURCE.provenance).toMatch(/session/i);
    expect(LANDING_SOURCE.commit).toMatch(/^[0-9a-f]{7,40}$/);
  });
});

describe("the AI reading is generated, not written", () => {
  // The reading is the most tempting thing on the page to improve by hand: it
  // is prose, it sells, and nobody would notice. These are the cheap checks
  // that make hand-editing it a deliberate act rather than a drift.
  it("carries the model and timestamp that produced it", () => {
    const r = LANDING_SOURCE.reading;
    expect(r.model, "no model id — did someone write this?").toMatch(/^claude-/);
    expect(Number.isNaN(Date.parse(r.generatedAt))).toBe(false);
    expect(r.provenance).toMatch(/explainFunction/);
  });

  it("describes the same function the chips do", () => {
    // A reading transcribed from a different run would talk about other code,
    // so tie it to the signals it was given. Deliberately NOT asserting that it
    // quotes the complexity: an unremarkable 5 is something the model may
    // reasonably not mention, and a test that demands it would push whoever
    // re-runs this toward editing the prose until it complies — the exact thing
    // the rest of this file exists to prevent.
    const r = LANDING_SOURCE.reading;
    const s = LANDING_SOURCE.signals;
    if (s.duplicateCount > 0) {
      expect(r.risk.toLowerCase()).toMatch(/duplicat|twin/);
      expect(r.risk, "the reading cites a different duplicate count").toContain(
        String(s.duplicateCount),
      );
    }
    if (!s.fileTested) expect(r.risk.toLowerCase()).toMatch(/test/);
  });

  it("uses the product's own section labels", () => {
    const aiReading = read("components", "views", "AiReading.tsx");
    for (const label of ["What it does", "Where the risk is", "Worth considering"]) {
      expect(aiReading, `the product renamed "${label}"`).toContain(label);
      expect(pane, `the pane renamed "${label}"`).toContain(label);
    }
  });

  it("keeps the disclosure the product shows at the point of action", () => {
    expect(pane).toContain("sent to Anthropic on");
    expect(pane).toContain("never stored");
  });
});

describe("the shown slice stays true to the file it names", () => {
  it("still exists, verbatim, at the line it claims", () => {
    // The fixture is a transcription. If lib/intelligence/classCanvas.ts moves
    // on, the landing is quoting code that is no longer there — the exact
    // staleness a screenshot has, reintroduced.
    const file = read(...LANDING_SOURCE.path.split("/")).split("\n");
    const slice = file
      .slice(LANDING_SOURCE.firstLine - 1, LANDING_SOURCE.firstLine - 1 + LANDING_SOURCE.code.split("\n").length)
      .join("\n");
    expect(slice).toBe(LANDING_SOURCE.code);
  });

  it("fits the column it is rendered in", () => {
    // MEASURED, not guessed: 84 characters at 12.5px in the split column as it
    // stands today. It has been 57, then 76, then this, each time because the
    // section got wider — so re-measure in the browser if .rk-split or its grid
    // ratio moves, rather than nudging the number until the test passes. A
    // slice past the limit renders clipped, which is what made the first
    // attempt look broken.
    const widest = Math.max(...LANDING_SOURCE.code.split("\n").map((l) => l.length));
    expect(widest, `widest line is ${widest} chars — pick a narrower slice`).toBeLessThanOrEqual(84);
  });

  it("points its chips at a line inside the slice", () => {
    const lines = LANDING_SOURCE.code.split("\n").length;
    expect(LANDING_SOURCE.fn.line).toBeGreaterThanOrEqual(LANDING_SOURCE.firstLine);
    expect(LANDING_SOURCE.fn.line).toBeLessThan(LANDING_SOURCE.firstLine + lines);
  });
});
