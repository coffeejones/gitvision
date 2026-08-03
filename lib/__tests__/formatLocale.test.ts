// Formatting that cannot differ between the server and the browser.
//
// A client component renders twice — once in Node, once in the visitor's
// browser — and `toLocaleDateString()` / `toLocaleString()` with no arguments
// read whichever locale each of those happens to have. When they disagree React
// discards the subtree and rebuilds it. Reproduced on a session page before the
// fix: the server (Node, en-US) wrote `5/19/2026` and `34,687`; the browser
// (da) wrote `19.5.2026` and `34.687`.
//
// The date was reported — it shows up as an error in the dev overlay. The four
// number sites were not, because the difference is one character.
//
// These tests assert the OUTPUT, and the guard at the bottom asserts nobody
// reintroduces an ambient-locale call in a client component.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { formatCount, formatDateAbs, formatDateTimeAbs } from "../formatLocale";

describe("formatCount", () => {
  it("groups thousands the way the English interface expects", () => {
    expect(formatCount(34687)).toBe("34,687");
    expect(formatCount(1234567)).toBe("1,234,567");
  });

  it("leaves short numbers alone", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
  });

  it("puts the separator at the boundary, not one digit off", () => {
    // The lookahead is the part that is easy to get wrong.
    expect(formatCount(1000)).toBe("1,000");
    expect(formatCount(999999)).toBe("999,999");
    expect(formatCount(1000000)).toBe("1,000,000");
  });

  it("keeps negatives and fractions intact", () => {
    expect(formatCount(-4200)).toBe("-4,200");
    expect(formatCount(1234.5)).toBe("1,234.5");
  });

  it("does not turn a non-number into nonsense", () => {
    expect(formatCount(NaN)).toBe("NaN");
    expect(formatCount(Infinity)).toBe("Infinity");
  });

  it("matches en-US grouping exactly", () => {
    // The implementation is ICU-free on purpose (small-icu builds, ICU version
    // drift), so pin it against the thing it is imitating.
    for (const n of [0, 5, 999, 1000, 34687, 1234567, 987654321]) {
      expect(formatCount(n), `${n}`).toBe(n.toLocaleString("en-US"));
    }
  });
});

describe("formatDateAbs", () => {
  it("writes an unambiguous date", () => {
    // Not 5/19/2026: that reads as 5 December to most of the world, and it sits
    // next to English relative strings like "2d ago".
    expect(formatDateAbs("2026-05-19T12:24:04.701Z")).toBe("19 May 2026");
  });

  it("renders in UTC, not the renderer's zone", () => {
    // A local-time render would put a Copenhagen browser and a UTC server on
    // different days either side of midnight — the same hydration bug, rarer
    // and far harder to spot.
    expect(formatDateAbs("2026-01-01T23:30:00.000Z")).toBe("1 Jan 2026");
    expect(formatDateAbs("2026-12-31T00:30:00.000Z")).toBe("31 Dec 2026");
  });

  it("returns empty rather than 'Invalid Date' on junk", () => {
    expect(formatDateAbs("not-a-date")).toBe("");
    expect(formatDateAbs("")).toBe("");
  });

  it("labels the time as UTC when it shows one", () => {
    expect(formatDateTimeAbs("2026-05-19T12:24:04.701Z")).toBe("19 May 2026, 12:24 UTC");
    expect(formatDateTimeAbs("2026-05-19T09:05:00.000Z")).toBe("19 May 2026, 09:05 UTC");
  });
});

describe("no client component reads the ambient locale", () => {
  /** Files carrying the "use client" directive — the only ones that render in
   *  BOTH Node and the browser, and therefore the only ones that can mismatch.
   *  Server components format once and ship the string, so an ambient locale
   *  there is a consistency question, not a hydration bug, and is out of scope
   *  for this guard. */
  function clientFiles(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...clientFiles(full));
      else if (e.name.endsWith(".tsx") || e.name.endsWith(".ts")) {
        if (/^\s*"use client";/m.test(readFileSync(full, "utf-8"))) out.push(full);
      }
    }
    return out;
  }

  const files = [
    ...clientFiles(path.join(process.cwd(), "components")),
    ...clientFiles(path.join(process.cwd(), "app")),
  ];

  it("finds client components to check", () => {
    // A guard that scans nothing passes forever.
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files.map((f) => path.relative(process.cwd(), f)))("%s", (rel) => {
    const src = readFileSync(path.join(process.cwd(), rel), "utf-8");
    // Bare calls only. An explicit locale — toLocaleString("en-US") — is
    // deterministic and allowed; it is the argument-less form that reads the
    // environment.
    const bare = src.match(/toLocale(?:Date|Time)?String\(\s*\)/g) ?? [];
    expect(
      bare,
      `reads the ambient locale — use formatCount / formatDateAbs from lib/formatLocale`,
    ).toEqual([]);
  });

  it("fails on the exact code that shipped", () => {
    // The guard is only worth its runtime if it rejects the two real forms.
    const before = [
      "return days < 30 ? `${days}d ago` : new Date(iso).toLocaleDateString();",
      "{stats.commits.toLocaleString()}",
    ];
    for (const line of before) {
      expect(line.match(/toLocale(?:Date|Time)?String\(\s*\)/g)).not.toBeNull();
    }
    // …and accepts the fixed forms, or every file would fail forever.
    for (const line of ['formatDateAbs(iso)', 'formatCount(stats.commits)', 'n.toLocaleString("en-US")']) {
      expect(line.match(/toLocale(?:Date|Time)?String\(\s*\)/g)).toBeNull();
    }
  });
});
