// The landing carried FOUR hand-copied palettes, and they had drifted.
//
// CTScreenshot, CTCodePane and CTBlastDiagram each held a transcribed TOK
// object, plus the real source of truth in codetrawl.css. Nothing enforced
// agreement, so the copies rotted quietly: #d29922 where the product uses
// CH.warning #c99a4e, #0d0b0a matching no token at all, a flat #cfcac3 across
// paragraphs the product deliberately tones differently. None of it was visible
// as a bug — it just made the rendered panes read as an imitation of the app
// instead of the app.
//
// Two rules now, both enforced here:
//   1. ./tokens CT must equal the custom properties on `.ct` in codetrawl.css.
//   2. The panes must IMPORT the product's theme, never transcribe it.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { TOK } from "@/lib/sessionTheme";
import { CT } from "@/components/landing/codetrawl/tokens";

const read = (...p: string[]) =>
  readFileSync(path.join(process.cwd(), ...p), "utf-8");

const css = read("components", "landing", "codetrawl", "codetrawl.css");
const LANDING = path.join("components", "landing", "codetrawl");

/** The custom properties declared on the `.ct` scope. */
function ctVars(): Record<string, string> {
  const block = css.match(/^\.ct \{([\s\S]*?)^\}/m);
  if (!block) throw new Error("could not find the .ct block in codetrawl.css");
  const out: Record<string, string> = {};
  for (const m of block[1].matchAll(/--ct-([a-z]+):\s*([^;]+);/g)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

/** Compare colours by value, not by spelling — "rgba(242, 239, 234, 0.09)" and
 *  "rgba(242,239,234,0.09)" are the same colour written two ways. */
const norm = (v: string) => v.toLowerCase().replace(/\s+/g, "");

describe("the landing palette mirrors the stylesheet", () => {
  const vars = ctVars();

  for (const key of Object.keys(CT) as (keyof typeof CT)[]) {
    it(`CT.${key} equals --ct-${key}`, () => {
      expect(vars[key], `--ct-${key} is not declared in codetrawl.css`).toBeDefined();
      expect(norm(CT[key])).toBe(norm(vars[key]));
    });
  }

  it("covers every colour token the stylesheet declares", () => {
    // A token added to the CSS but not here is how the copies drifted the first
    // time: the component reaches for a value that has no counterpart and
    // someone types a near-miss.
    const colourish = Object.entries(vars).filter(([, v]) => /^#|^rgba?\(/.test(v));
    for (const [name] of colourish) {
      expect(Object.keys(CT), `--ct-${name} has no CT entry`).toContain(name);
    }
  });
});

describe("the rendered panes import the product's theme", () => {
  const panes = ["CTCodePane.tsx", "CTBlastDiagram.tsx"];

  for (const file of panes) {
    const src = read(LANDING, file);

    it(`${file} imports TOK rather than transcribing it`, () => {
      expect(src).toMatch(/import \{ TOK \} from "@\/lib\/sessionTheme"/);
    });

    it(`${file} hardcodes no palette colour`, () => {
      // Neutral white overlays are allowed: the product writes those inline too
      // (AiReading's chip background is a literal rgba(255,255,255,0.03)), and
      // they carry no hue to drift. A HEX, or any tinted rgba, is a palette
      // value that belongs to TOK or CT.
      const offenders = src
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .flatMap((line) => [...line.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(([^)]*)\)/g)])
        .map((m) => ({ lit: m[0], args: m[1] }))
        .filter(({ lit, args }) => {
          if (lit.startsWith("#")) return true;
          const [r, g, b] = args.split(",").map((n) => Number(n.trim()));
          return !(r === 255 && g === 255 && b === 255);
        })
        .map((o) => o.lit);
      expect(offenders, `hardcoded palette colour in ${file}`).toEqual([]);
    });
  }
});

describe("the code pane grades severity the way the product does", () => {
  const pane = read(LANDING, "CTCodePane.tsx");

  it("takes the complexity colour from complexityTone, not from a choice here", () => {
    // The pinned function scores 5, which the product calls "low" and draws in
    // quiet grey — "explainable but not risky". The pane used to hardcode amber
    // and so advertised a warning the app does not raise. Deriving it means a
    // future slice with a different score gets the right colour for free.
    expect(pane).toMatch(/import \{ complexityTone \} from "@\/lib\/sourceAnnotations"/);
    expect(pane).toMatch(/tone === "high" \? TOK\.rose : tone === "medium" \? TOK\.amber : TOK\.textMuted/);
    expect(pane).not.toMatch(/Complexity \$\{[^}]+\}`\} color=\{AMBER\}/);
  });

  it("still shows the unflattering chips in full amber", () => {
    // The other half of the same rule: the duplicate and no-test chips ARE
    // mid-severity in the product, and softening them would be the version of
    // this pane that only shows good news.
    expect(pane).toMatch(/twin\$\{[\s\S]*?color=\{AMBER\}/);
    expect(pane).toMatch(/label="No test guards it" color=\{AMBER\}/);
  });

  it("keeps small content text above the landing's AA floor", () => {
    // codetrawl.css: "faint carries CONTENT at the smallest sizes — keep it
    // >=4.5:1 on surface". The pane's own MUTED used to be #6e6a64, which is
    // 3.36:1 on the panel and carried the line numbers, the eyebrows and the
    // disclosure line. TOK.textMuted is 5.05:1.
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const [r, g, b] = c.map((v) =>
        v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
      );
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    expect(contrast(TOK.textMuted, TOK.surface)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the blast diagram matches the canvas it depicts", () => {
  const diagram = read(LANDING, "CTBlastDiagram.tsx");
  const canvas = read("components", "views", "FaultlineBlastCanvas.tsx");

  it("tints only the leading edge of an untested card", () => {
    // The canvas paints UNTESTED_BG = a rose gradient that is gone by 30%, over
    // a NEUTRAL panel. The first draft of this diagram flooded the whole card
    // instead, which both lied about the product and put twelve solid orange
    // rectangles on a page whose accent is rationed.
    expect(canvas).toMatch(/linear-gradient\(90deg, \$\{TOK\.roseSoft\} 0%, transparent 30%\)/);
    expect(diagram).toMatch(/offset="30%"[\s\S]*?stopOpacity=\{0\}/);
    expect(diagram).toMatch(/fill=\{TOK\.surface\}/);
  });

  it("draws straight edges, as the canvas does", () => {
    // Beziers radiating from one origin cross into a thicket; the canvas uses
    // type: "straight" and so does this.
    expect(canvas).toMatch(/type: "straight"/);
    expect(diagram).toContain("<line");
    expect(diagram).not.toContain("strokeDasharray");
  });

  it("changes shape on a phone instead of shrinking", () => {
    // The justification for rendering these panes rather than photographing
    // them is written in CTCodePane's header: a screenshot "cannot reflow on a
    // phone". At 375px the graph's viewBox scales by 0.34 and its smallest
    // label lands at 4.2px, so the graph is swapped for a list rather than
    // merely made smaller. Exactly one of the two is ever displayed.
    const landing = read(LANDING, "CodeTrawlLanding.tsx");
    expect(diagram).toContain('className="ct-blast-graph"');
    expect(diagram).toContain('className="ct-blast-list"');
    expect(landing).toMatch(/\.rk \.ct-blast-list \{ display: none; \}/);
    expect(landing).toMatch(/\.rk \.ct-blast-graph \{ display: none; \}[\s\S]*?\.rk \.ct-blast-list \{ display: block; \}/);
  });

  it("shows the same casualties in both shapes", () => {
    // A list that quietly dropped the covered files would make the phone
    // version the advertisement version.
    const listBlock = diagram.slice(diagram.indexOf('className="ct-blast-list"'));
    expect(listBlock).toContain("casualties.map");
    expect(listBlock).toMatch(/c\.untested \? "NO TEST" : "COVERED"/);
    expect(listBlock).toMatch(/inset 4px 0 0 \$\{ROSE\}/);
  });

  it("keeps the type legible after the shot's downscale", () => {
    // A 1020-unit viewBox rendered at ~790px puts the product's 9.5px label at
    // 7.3 — below every other size on the landing. Type is pre-divided so it
    // lands at the product's own size instead.
    const scale = Number(diagram.match(/const SHOT_SCALE = ([0-9.]+)/)![1]);
    expect(scale).toBeGreaterThan(0.5);
    expect(scale).toBeLessThan(1);

    // The real guarantee: EVERY label in the SVG goes through px(), so a label
    // added later cannot quietly arrive at two-thirds the size of its
    // neighbours. Asserting the arithmetic of px() would only re-state the
    // formula; asserting that nothing bypasses it catches the actual mistake.
    const raw = [...diagram.matchAll(/fontSize=\{(?!px\()([^}]+)\}/g)].map((m) => m[1]);
    expect(raw, "a font size in the SVG bypasses px()").toEqual([]);
    expect(diagram).toMatch(/fontSize=\{px\(9\.5\)\}/);
  });
});
