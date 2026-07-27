// The hero shot mounts HeadlineFinding and HealthSummary, so their appearance
// cannot drift from the product. What can go wrong is the pinned INPUT: a
// status nudged greener, a sentence tidied, or — the quiet one — a shape that
// stops matching what the components expect and renders as nothing.
//
// The last is the reason the strip must be checked at all. HealthSummary
// returns NULL when every dimension is "unknown", so a fixture that drifted out
// of shape would not look wrong on the hero; it would look like the strip was
// never there.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  LANDING_HEADLINE,
  LANDING_HEALTH,
  LANDING_OVERVIEW_PROVENANCE,
} from "../landingOverview";
import { LANDING_SECURITY_SNAPSHOT } from "../landingSecurity";

const read = (...p: string[]) =>
  readFileSync(path.join(process.cwd(), ...p), "utf-8");

const pane = read("components", "landing", "codetrawl", "CTOverviewPane.tsx");
const summary = read("components", "views", "HealthSummary.tsx");

describe("the hero mounts the product", () => {
  it("renders HeadlineFinding and HealthSummary themselves", () => {
    expect(pane).toMatch(/import \{ HeadlineFinding \} from "@\/components\/HeadlineFinding"/);
    expect(pane).toMatch(/import \{ HealthSummary \} from "@\/components\/views\/HealthSummary"/);
    expect(pane).toContain("<HeadlineFinding");
    expect(pane).toContain("<HealthSummary");
  });

  it("does not restate the strip's own header", () => {
    // HealthSummary draws "HEALTH AT A GLANCE · rule-based signals · no AI
    // required" itself; a first draft repeated it and the hero carried the line
    // twice.
    // Strip block comments as well as line ones — the pane explains the
    // duplicate in a JSX comment, and quoting the header there is the point.
    const code = pane.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/rule-based signals/i);
    expect(summary).toMatch(/rule-based signals/i);
  });

  it("re-points the font variables product components style through", () => {
    expect(pane).toMatch(/"--font-mono": "var\(--font-ct-mono\)"/);
  });
});

describe("the pinned strip is a real sweep, in the shape the strip needs", () => {
  it("records how it was derived", () => {
    expect(LANDING_OVERVIEW_PROVENANCE).toMatch(/summarizeHealth/);
    expect(LANDING_OVERVIEW_PROVENANCE).toMatch(/2026-07-27/);
  });

  it("covers all six dimensions in the product's order", () => {
    expect(LANDING_HEALTH.map((d) => d.id)).toEqual([
      "activity",
      "team",
      "code",
      "pr-flow",
      "deps",
      "hygiene",
    ]);
  });

  it("never renders as nothing", () => {
    // HealthSummary bails out entirely when every dimension is unknown, which
    // would leave a hole above the fold rather than a visible mistake.
    expect(summary).toMatch(/summaries\.every\(\(d\) => d\.status === "unknown"\)/);
    expect(LANDING_HEALTH.every((d) => d.status === "unknown")).toBe(false);
    for (const d of LANDING_HEALTH) {
      expect(d.detail, `${d.id} has no evidence sentence`).toBeTruthy();
      expect(d.statusLabel).toBeTruthy();
    }
  });

  it("keeps the unflattering tile", () => {
    // Five healthy and one critical is what the analyzer returned. A hero strip
    // edited to all-green would be the fake version of the one panel on this
    // page whose entire claim is that it was computed.
    expect(LANDING_HEALTH.filter((d) => d.status === "critical")).toHaveLength(1);
    expect(LANDING_HEALTH.find((d) => d.id === "code")!.status).toBe("critical");
  });

  it("leads with a finding, not a compliment", () => {
    expect(LANDING_HEADLINE.severity).not.toBe("good");
    expect(LANDING_HEADLINE.primary).toMatch(/untested/i);
    expect(LANDING_HEADLINE.detail).toMatch(/blueprints\.py/);
  });

  it("comes from the same sweep as the security shot", () => {
    // Two shots on one page showing the same repo at two different moments
    // would be a contradiction nobody would catch by eye.
    expect(LANDING_SECURITY_SNAPSHOT.repo.fullName).toBe("pallets/flask");
    expect(LANDING_OVERVIEW_PROVENANCE).toContain("pallets");
  });
});
