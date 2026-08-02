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

describe("no surface hardcodes the count", () => {
  // The eight sites that drifted, plus the modules that own the numbers. A
  // literal here is the exact defect this arc fixed.
  const SURFACES = [
    ["app", "(workspace)", "how-it-works", "page.tsx"],
    ["app", "session", "[id]", "page.tsx"],
    ["app", "session", "[id]", "signals", "page.tsx"],
    ["app", "session", "[id]", "verdict", "page.tsx"],
    ["components", "SessionShell.tsx"],
    ["components", "chambers", "HowItWorksView.tsx"],
    ["components", "views", "HealthSummary.tsx"],
    ["lib", "intelligence", "healthSummary.ts"],
    ["lib", "intelligence", "verdict.ts"],
  ];

  it.each(SURFACES)("%s/%s quotes the count from the map", (...parts) => {
    // Comments are stripped: this file's own header quotes the strings it
    // rejects, and explaining the defect must not trip the guard against it.
    const src = read(...parts)
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    // Deliberately narrow. "top 3 signals" is a legitimate slice size; only
    // "N deterministic ..." claims the size of the whole signal set, which is
    // the claim that drifted. Every one of the eight sites used that phrase.
    const literal = src.match(/~?\d+\s+deterministic[^\n]*/g) ?? [];
    expect(
      literal,
      "hardcoded signal count — interpolate HEALTH_SIGNAL_COUNT or VERDICT_SIGNAL_COUNT instead",
    ).toEqual([]);
  });

  it("would have caught the original drift", () => {
    // The guard above only earns trust if it fails on the string it exists to
    // reject. Run it against what the code actually said before this fix.
    const before = 'description="Grounded in 20 deterministic signals · zero hallucination"';
    expect(before.match(/~?\d+\s+deterministic[^\n]*/g)).not.toBeNull();
  });
});
