// The social card must actually render.
//
// It broke, and nothing noticed. Interpolating a constant turned
// `<div>20 computed signals</div>` into `<div>{N} computed signals</div>` —
// two JSX children where there had been one — and Satori refuses a div with
// more than one child unless it declares an explicit display. The route then
// answered with nothing at all: no status, no bytes, no failing test, no build
// error. The only symptom would have been a blank preview the first time
// somebody shared a link to codetrawl.com.
//
// tsc cannot see this (the JSX is valid) and `next build` does not exercise the
// route. So render it here. It costs ~200ms and it is the only thing standing
// between a copy edit and a dead social card.

import { describe, it, expect } from "vitest";

import { HEALTH_SIGNAL_COUNT } from "../intelligence/healthSummary";

/** Render the route the way Next does. The default export returns an
 *  ImageResponse, which IS a Response subclass but is not typed as one and is
 *  not a promise — hence the two-step cast rather than a direct one. */
async function render(): Promise<Buffer> {
  const mod = await import("../../app/opengraph-image");
  const res = (mod.default as unknown as () => Response)();
  expect(res.status, "the OG route did not answer 200").toBe(200);
  return Buffer.from(await res.arrayBuffer());
}

describe("the OpenGraph card", () => {
  it("renders a real PNG", async () => {
    const buf = await render();
    // Satori failures surface as an empty or non-image body rather than a
    // throw, so assert the magic bytes rather than merely "it resolved".
    expect(buf.subarray(1, 4).toString(), "not a PNG — Satori rejected the tree").toBe("PNG");
    expect(buf.length, "suspiciously small for a 1200x630 card").toBeGreaterThan(10_000);
  }, 30_000);

  it("states the signal count it derives, not one somebody typed", async () => {
    // The card is the most-shared surface and the least-looked-at. It carried
    // "20" while the engine computed 34, on every link preview.
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const src = readFileSync(
      path.default.join(process.cwd(), "app", "opengraph-image.tsx"),
      "utf-8",
    );
    expect(src).toContain("HEALTH_SIGNAL_COUNT");
    // And the derived value is a real number, so the card cannot say "0" or
    // "undefined" if the maps are ever emptied.
    expect(HEALTH_SIGNAL_COUNT).toBeGreaterThan(20);
  });

  it("keeps every multi-child div explicitly displayed", async () => {
    // The rule that broke it, checked directly. Satori needs `display` on any
    // div with more than one child; JSX interpolation next to text is the easy
    // way to create one by accident.
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const src = readFileSync(
      path.default.join(process.cwd(), "app", "opengraph-image.tsx"),
      "utf-8",
    );
    // A single-line <div> whose body mixes an interpolation with bare text.
    const risky = [...src.matchAll(/<div(?![^>]*style)[^>]*>(?![^<]*<\/div>\s*$)[^<>{}]*\{[^}]+\}[^<>{}]+<\/div>/g)];
    expect(
      risky.map((m) => m[0]),
      "a div mixes {interpolation} with text and declares no display — Satori will reject it",
    ).toEqual([]);
  });
});
