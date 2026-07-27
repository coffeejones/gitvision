// The React Flow control panel must stay themed, and themed to the palette the
// canvas actually sits on.
//
// @xyflow/react ships a LIGHT stylesheet. Nothing overrode it, so every canvas
// in the app — Faultline, Flows, Imports, Architecture, Constellation — drew a
// white zoom panel on a near-black surface, and that panel was baked into the
// Faultline screenshot on the landing page, where it was the brightest object
// on the marketing site.
//
// The first fix used the --surface-* variables in globals.css. Those are the
// OLDER cool palette (#14141B / #23232E) while the session surface paints the
// warm Chambers palette (CH.panel #171615), so it put a blue-grey chip on a
// warm canvas — correct in the sense of "not white", wrong in the sense of
// "belongs here". These tests pin the values to the palette that is actually on
// screen, so a palette change fails here instead of drifting in silence.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { CH } from "../../components/chambers/theme";

const css = readFileSync(
  path.join(process.cwd(), "app", "globals.css"),
  "utf-8",
);

/** The value assigned to a custom property in globals.css. */
function cssVar(name: string): string {
  const m = css.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  if (!m) throw new Error(`${name} is not set in globals.css`);
  return m[1].trim();
}

describe("React Flow chrome is themed", () => {
  it("overrides the library's light defaults at all", () => {
    // The library reads these; if they are absent its own light values win and
    // the white panel is back.
    for (const name of [
      "--xy-controls-button-background-color",
      "--xy-controls-button-color",
      "--xy-controls-button-border-color",
    ]) {
      expect(() => cssVar(name), `${name} is missing`).not.toThrow();
    }
  });

  it("uses the warm palette the canvas actually sits on", () => {
    expect(cssVar("--xy-controls-button-background-color").toLowerCase()).toBe(
      CH.elevated.toLowerCase(),
    );
    expect(cssVar("--xy-minimap-background-color").toLowerCase()).toBe(
      CH.panel.toLowerCase(),
    );
  });

  it("does not theme the controls from the stale cool globals", () => {
    // #23232E / #14141B are the pre-Chambers values still defined further down
    // globals.css for other surfaces. Reaching for them here is the exact
    // mistake this file exists to catch.
    // Slice the DECLARATIONS, not the comment above them — the prose there
    // names the stale values on purpose, to say why they are not used.
    const start = css.indexOf(":root {", css.indexOf("React Flow chrome"));
    const block = css.slice(start, css.indexOf("}", start));
    expect(block).not.toMatch(/var\(--surface-elevated\)/);
    expect(block.toLowerCase()).not.toContain("#23232e");
  });

  it("keeps the button border and the group border the same colour", () => {
    // The group border is written literally because it is not one of the
    // library's variables; it must not drift from the divider between buttons.
    expect(cssVar("--xy-controls-button-border-color").replace(/\s/g, "")).toBe(
      CH.border.replace(/\s/g, ""),
    );
    expect(css).toContain("border: 1px solid rgba(255, 255, 255, 0.08)");
  });
});
