// Coverage for the README trend badge SVG builder (lib/badge.ts).

import { describe, it, expect } from "vitest";
import { gradeBadgeSvg, neutralBadgeSvg } from "../badge";

describe("gradeBadgeSvg", () => {
  it("renders a valid badge with grade + down arrow", () => {
    const svg = gradeBadgeSvg({ grade: "B+", trend: "down" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("codetrawl");
    expect(svg).toContain("B+ ↘");
    // lime for the B band
    expect(svg).toContain("#6fa524");
  });

  it("maps grade bands to the green → red ramp", () => {
    expect(gradeBadgeSvg({ grade: "A", trend: "none" })).toContain("#2ea043");
    expect(gradeBadgeSvg({ grade: "C-", trend: "none" })).toContain("#b8860b");
    expect(gradeBadgeSvg({ grade: "F", trend: "none" })).toContain("#d1242f");
  });

  it("shows the matching arrow per trend, and none when flat/absent", () => {
    expect(gradeBadgeSvg({ grade: "A", trend: "up" })).toContain("A ↗");
    expect(gradeBadgeSvg({ grade: "A", trend: "flat" })).toContain("A →");
    // "none" → bare grade, no arrow glyph
    const bare = gradeBadgeSvg({ grade: "A", trend: "none" });
    expect(bare).toContain(">A<");
    expect(/[↗↘→]/.test(bare)).toBe(false);
  });
});

describe("neutralBadgeSvg", () => {
  it("renders the private/neutral badge without a grade color", () => {
    const svg = neutralBadgeSvg("private");
    expect(svg).toContain("private");
    expect(svg).toContain("codetrawl");
    // none of the grade-ramp colors leak in
    for (const c of ["#2ea043", "#6fa524", "#b8860b", "#e8730f", "#d1242f"]) {
      expect(svg).not.toContain(c);
    }
  });
});
