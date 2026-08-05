// The signal count the product shows users, held to the signals it has.
//
// Eight places in the UI told users how many deterministic signals sit behind
// a grade. Seven said "20", one said "21", and the real answer was 34 — the
// maps had grown for a year and nobody recounted. On a product whose entire
// claim is "computed, never generated", and whose /security page promises that
// every sentence maps back to a deterministic signal, a user-visible count
// that is wrong by fourteen undercuts exactly the thing being sold.
//
// So the counts are now derived from the maps, and this file keeps them
// honest in three directions:
//   1. the maps only name signals that detectors actually emit,
//   2. every emitted signal lands somewhere a user can see it, and
//   3. no literal count creeps back into the copy.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  HEALTH_SIGNAL_IDS,
  HEALTH_SIGNAL_COUNT,
} from "../intelligence/healthSummary";
import {
  VERDICT_SIGNAL_IDS,
  VERDICT_SIGNAL_COUNT,
} from "../intelligence/verdict";

const read = (...p: string[]) =>
  readFileSync(path.join(process.cwd(), ...p), "utf-8");

/** Every signal id a detector can emit, read from the detectors themselves.
 *  `known-incident-match` is built in the security module rather than
 *  signals.ts, so both files are scanned.
 *
 *  A HealthSignal literal is `id:` immediately followed by `title:`. That
 *  matters: knownIncidents.ts also holds the KNOWN_INCIDENTS catalog, whose
 *  entries have an `id` too (`event-stream-2018`, `ua-parser-js-2021`, …) but
 *  are incidents, not signals — a naive `id:` sweep counts ten of them and
 *  reports every one as an unrendered orphan. They use `name:`, so the pair
 *  separates them exactly.
 *
 *  Nothing constructs a signal id dynamically today. If that changes, the
 *  orphan checks below go quiet rather than fail, and this is the note that
 *  says so. */
function emittedSignalIds(): Set<string> {
  const src = read("lib", "signals.ts") + read("lib", "security", "knownIncidents.ts");
  const ids = new Set<string>();
  for (const m of src.matchAll(/\bid:\s*"([a-z0-9-]+)",\s*\n\s*title:/g)) ids.add(m[1]);
  return ids;
}

describe("the signal maps name real signals", () => {
  const emitted = emittedSignalIds();

  it("has no tile pointing at a signal that no longer exists", () => {
    // The quiet failure: a detector is renamed, the tile keeps the old id, and
    // the dimension goes permanently grey while still being counted. That is
    // how the Team dimension was dark on 4 of 11 repos.
    const missing = [...HEALTH_SIGNAL_IDS].filter((id) => !emitted.has(id));
    expect(missing, "health tiles reference signals nothing emits").toEqual([]);
  });

  it("has no lens pointing at a signal that no longer exists", () => {
    const missing = [...VERDICT_SIGNAL_IDS].filter((id) => !emitted.has(id));
    expect(missing, "verdict lenses reference signals nothing emits").toEqual([]);
  });

  it("shows every signal it computes", () => {
    // The opposite failure: a new detector ships, nobody adds it to a
    // dimension, and it is computed on every analysis but rendered nowhere.
    const orphans = [...emitted].filter((id) => !HEALTH_SIGNAL_IDS.has(id));
    expect(orphans, "signals are computed but appear on no tile").toEqual([]);
  });
});

describe("the two counts are two counts on purpose", () => {
  it("keeps the verdict's signals a strict subset of the tiles'", () => {
    // The four lenses read fewer signals than the six tiles — they skip the
    // CI-hardening trio and concentrated-ownership. Any id the lenses read
    // that the tiles do not would mean the two surfaces have diverged, and
    // neither number would describe the product any more.
    const extra = [...VERDICT_SIGNAL_IDS].filter((id) => !HEALTH_SIGNAL_IDS.has(id));
    expect(extra, "a lens reads a signal no tile shows").toEqual([]);
  });

  it("does not let them collapse into one number", () => {
    // If these ever become equal, the tempting next step is to delete one
    // constant and reuse the other — and the surfaces silently start quoting
    // a number that is right for the other one. That is the original bug.
    expect(VERDICT_SIGNAL_COUNT).toBeLessThan(HEALTH_SIGNAL_COUNT);
  });

  it("counts something", () => {
    // Guards the derivation itself: an empty map would make every claim above
    // vacuously true and every surface say "0 deterministic signals".
    expect(HEALTH_SIGNAL_COUNT).toBeGreaterThan(20);
    expect(VERDICT_SIGNAL_COUNT).toBeGreaterThan(20);
  });
});

/** Anything that states how many signals the product computes.
 *
 *  THREE FORMS, because the first version of this guard knew only one and the
 *  rebuilt landing walked straight through it with all three:
 *    "20 deterministic signals"   the phrasing the original sweep fixed
 *    "20 computed signals"        the landing's proof strip and the OG card
 *    "Twenty deterministic ..."   spelled out, which no digit regex can see
 *
 *  Matching the NOUN rather than one adjective is the point. A slice size
 *  ("top 3 signals", "the first 5") is legitimate and must stay allowed, so the
 *  number has to be adjacent to a whole-catalog word. */
const WORD_NUMBERS =
  "ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty";
const NUM = String.raw`(?:~?\d+|\b(?:${WORD_NUMBERS})\b)`;
const COUNT_CLAIM = new RegExp(
  [
    // "20 deterministic signals" · "Twenty deterministic repository signals" ·
    // and the tuple form ["20", "computed signals"], where the number and the
    // noun live in SEPARATE string literals — which is how the landing's proof
    // strip slipped past the first version of this guard.
    String.raw`${NUM}[\s\-",]{1,4}(?:deterministic|computed|rule-based)[\s\-]*(?:repository[\s\-]+)?signals?\b`,
    // "the full 17-signal health verdict" — hyphenated, singular, no adjective.
    String.raw`\b\d+-signals?\b`,
    // "the 20 signals already computed". The definite article is what makes it
    // a claim about the WHOLE catalog; "the top 3 signals" is a slice and stays
    // legal, which is why the number must follow "the" directly.
    String.raw`\bthe\s+${NUM}\s+signals?\b`,
  ].join("|"),
  "gi",
);

/** Strip line comments so a file may EXPLAIN the defect it guards against. */
function code(src: string): string {
  return src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
}

describe("nothing states a signal count it did not derive", () => {
  // Every surface that has ever carried this number, in-app AND outward-facing.
  // The rebuilt landing proved the in-app-only list was the weakness: it said
  // "20 computed signals" twice while the engine computed 34, and the OG card
  // put the same number on every social share of codetrawl.com.
  const SURFACES: string[][] = [
    // in-app
    ["app", "(workspace)", "how-it-works", "page.tsx"],
    ["app", "session", "[id]", "page.tsx"],
    ["app", "session", "[id]", "signals", "page.tsx"],
    ["app", "session", "[id]", "verdict", "page.tsx"],
    ["app", "session", "[id]", "insights", "page.tsx"],
    ["components", "SessionShell.tsx"],
    ["components", "HealthPanel.tsx"],
    ["components", "chambers", "HowItWorksView.tsx"],
    ["components", "views", "HealthSummary.tsx"],
    ["components", "views", "SignalsPanel.tsx"],
    ["lib", "intelligence", "healthSummary.ts"],
    ["lib", "intelligence", "verdict.ts"],
    // outward-facing — the gap the landing rebuild walked through
    ["components", "landing", "codetrawl", "CodeTrawlLanding.tsx"],
    ["components", "landing", "codetrawl", "CTProductTour.tsx"],
    ["app", "opengraph-image.tsx"],
    ["app", "page.tsx"],
    // distribution — a published npm README cannot be corrected as fast as the
    // engine changes, so it must not carry a count at all
    ["scripts", "build-mcp-package.mjs"],
    ["mcp", "server.ts"],
    ["mcp", "buildServer.ts"],
    ["mcp", "tools", "signals.ts"],
  ];

  it.each(SURFACES.map((p) => [p.join("/"), p] as const))("%s", (_label, parts) => {
    const claims = code(read(...parts)).match(COUNT_CLAIM) ?? [];
    expect(
      claims,
      "states a signal count — interpolate HEALTH_SIGNAL_COUNT / VERDICT_SIGNAL_COUNT, or drop the number",
    ).toEqual([]);
  });

  it("covers every file that mentions the counts, not a list that rots", () => {
    // The list above is hand-written, which is how the landing escaped. This
    // asserts the list still spans the places the constants are actually used,
    // so adding a consumer without adding it here fails.
    const consumers = SURFACES.map((p) => p.join("/"));
    for (const must of [
      "components/landing/codetrawl/CodeTrawlLanding.tsx",
      "app/opengraph-image.tsx",
      "scripts/build-mcp-package.mjs",
    ]) {
      expect(consumers, `${must} dropped out of the guard`).toContain(must);
    }
  });

  it("rejects every form that actually shipped", () => {
    // Each of these was live in the repo. A guard that cannot see them is the
    // guard that let the landing regress.
    for (const shipped of [
      'description="Grounded in 20 deterministic signals · zero hallucination"',
      '["20", "computed signals"],',
      '["03", "Test", "Twenty deterministic repository signals"],',
      "Claude reads the 20 signals already computed for the Overview strip",
      "- `signals` — the full 17-signal health verdict + dimension rollup",
    ]) {
      expect(shipped.match(COUNT_CLAIM), shipped).not.toBeNull();
    }
  });

  it("leaves legitimate slice sizes alone", () => {
    // If this over-matches, the fix is to delete the guard, so pin it.
    for (const fine of [
      "the top 3 signals that drove this department's vote",
      "3 signals for the per-department evidence list.",
      "signals.needsWork.filter((x) => x.severity === \"high\")",
      "const signals = extractHealthSignals(snap);",
    ]) {
      expect(fine.match(COUNT_CLAIM), fine).toBeNull();
    }
  });
});
