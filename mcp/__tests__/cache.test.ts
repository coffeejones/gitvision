// Tests for sessionIdFor (v0.79+) — verifies that passing a ref folds
// it into the cache key so two analyses of the same repo at different
// refs get distinct ids. Backward-compatible: no-ref calls produce the
// same hash as before.
//
// Doesn't test the actual disk/memory cache machinery — those are
// integration-y (filesystem, TTL clocks) and not currently covered by
// unit tests. This file is specifically the session-id derivation
// contract that analyze_diff relies on.

import { describe, it, expect } from "vitest";
import { sessionIdFor } from "../cache";

describe("sessionIdFor", () => {
  it("returns a stable 12-char hex id for a given URL", () => {
    const id = sessionIdFor("https://github.com/pallets/flask");
    expect(id).toMatch(/^[a-f0-9]{12}$/);
    expect(sessionIdFor("https://github.com/pallets/flask")).toBe(id);
  });

  it("produces different ids for different repo URLs", () => {
    const a = sessionIdFor("https://github.com/pallets/flask");
    const b = sessionIdFor("https://github.com/colinhacks/zod");
    expect(a).not.toBe(b);
  });

  it("backward compatible: undefined ref produces the same id as no ref arg", () => {
    const noArg = sessionIdFor("https://github.com/pallets/flask");
    const undef = sessionIdFor("https://github.com/pallets/flask", undefined);
    const nullRef = sessionIdFor("https://github.com/pallets/flask", null);
    expect(undef).toBe(noArg);
    expect(nullRef).toBe(noArg);
  });

  it("produces different ids for different refs of the same repo", () => {
    const url = "https://github.com/pallets/flask";
    const main = sessionIdFor(url, "main");
    const branch = sessionIdFor(url, "feature-x");
    const tag = sessionIdFor(url, "v3.0.0");
    expect(main).not.toBe(branch);
    expect(main).not.toBe(tag);
    expect(branch).not.toBe(tag);
  });

  it("ref-keyed id is stable across calls", () => {
    const url = "https://github.com/pallets/flask";
    const a = sessionIdFor(url, "main");
    const b = sessionIdFor(url, "main");
    expect(a).toBe(b);
  });

  it("URL+ref is distinguished from URL-without-ref", () => {
    // A ref-explicit call MUST produce a different id than the bare
    // URL — otherwise PR-bot workflows that explicitly request the
    // default branch would collide with prior whole-repo analyses,
    // overwriting the cache.
    const url = "https://github.com/pallets/flask";
    expect(sessionIdFor(url, "main")).not.toBe(sessionIdFor(url));
  });

  it("treats empty-string ref as no ref (defensive)", () => {
    // Empty string is falsy, so the implementation treats it like
    // undefined. Prevents accidental cache splits when the caller
    // passes "" instead of undefined for "use default".
    const url = "https://github.com/pallets/flask";
    expect(sessionIdFor(url, "")).toBe(sessionIdFor(url));
  });
});
