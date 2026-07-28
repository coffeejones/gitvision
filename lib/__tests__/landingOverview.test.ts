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
  LANDING_ORIENTATION_LINE,
  LANDING_OVERVIEW_PROVENANCE,
  LANDING_WORKSPACE,
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

  it("quotes the route's own orientation line", () => {
    // The route has two branches — with a diff and without — and the shot is a
    // first sweep, so it must be the no-diff one.
    const route = read("app", "session", "[id]", "page.tsx");
    expect(route).toContain(LANDING_ORIENTATION_LINE);
  });

  it("mounts the Workspace card rather than copying it", () => {
    // QuickLookCard used to be a local, unexported function inside the route,
    // so showing a Workspace tile anywhere else meant copying sixty lines. It
    // was moved to components/views/ instead; both the route and the landing
    // import it, and the extraction is only worth anything if it stays that way.
    expect(pane).toMatch(
      /import \{ QuickLookCard \} from "@\/components\/views\/QuickLookCard"/,
    );
    const route = read("app", "session", "[id]", "page.tsx");
    expect(route).toMatch(
      /import \{ QuickLookCard \} from "@\/components\/views\/QuickLookCard"/,
    );
    expect(route).not.toMatch(/^function QuickLookCard\(/m);
  });

  it("carries every Workspace tab, each with a real stat", () => {
    expect(LANDING_WORKSPACE.map((c) => c.tab)).toEqual([
      "canvas",
      "imports",
      "code",
      "architecture",
      "packages",
      "prs",
      "insights",
    ]);
    for (const c of LANDING_WORKSPACE) {
      expect(c.stat, `${c.tab} has no stat`).toBeTruthy();
      // "Refresh to populate" / "No PR data" are the route's EMPTY states. A
      // shot showing them would be advertising a sweep that found nothing.
      expect(c.stat).not.toMatch(/refresh to populate|no .* data|not detected/i);
    }
  });

  it("keeps the rollup bar in step with the tiles it sits above", () => {
    // The bar's segments are counted per status over the same six summaries, so
    // the two can only disagree if a new status appears — which shows up here
    // as segments that no longer sum to the number of tiles.
    const tiers = ["critical", "warning", "healthy", "solo", "unknown"];
    const counted = tiers.reduce(
      (n, t) => n + LANDING_HEALTH.filter((s) => s.status === t).length,
      0,
    );
    expect(counted).toBe(LANDING_HEALTH.length);
    expect(pane).toContain("ROLLUP_TIERS");
  });

  it("comes from the same sweep as the security shot", () => {
    // Two shots on one page showing the same repo at two different moments
    // would be a contradiction nobody would catch by eye.
    expect(LANDING_SECURITY_SNAPSHOT.repo.fullName).toBe("pallets/flask");
    expect(LANDING_OVERVIEW_PROVENANCE).toContain("pallets");
  });
});
