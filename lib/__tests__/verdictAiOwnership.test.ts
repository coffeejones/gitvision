// Generating a verdict narrative WRITES to someone's analysis, so it must be
// gated on ownership, not merely on the viewer's AI entitlement.
//
// It wasn't. A public analysis is readable by anyone with the link, and the
// generation guard asked only "is this viewer entitled to AI" — true for every
// signed-in account in the free phase. So the first signed-in stranger to open
// your verdict page generated on your behalf: it spent the shared daily AI
// budget and called patchLatestSnapshot on YOUR session file. You had not asked
// for it and could not have prevented it.
//
// This is a source guard rather than a render test because the subject is a
// server component that reaches for auth, storage and the Anthropic SDK; the
// property worth pinning is structural — every write in this file sits behind
// the ownership check — and that is exactly what a regex can see and a
// refactor is likely to lose.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const FILE = path.join(
  process.cwd(),
  "app",
  "session",
  "[id]",
  "verdict",
  "page.tsx",
);
const src = readFileSync(FILE, "utf-8");

describe("verdict page — AI generation is owner-only", () => {
  it("derives ownership from the shared helper, not an ad-hoc comparison", () => {
    expect(src).toContain('from "@/lib/ownership"');
    expect(src).toMatch(/checkSessionOwnership\(\s*session,/);
  });

  it("gates every snapshot write behind the ownership check", () => {
    // Each patchLatestSnapshot lives inside an `if (...) { ... }` guard. Take
    // the condition that opens the block containing each write and require
    // isOwner in it.
    const writeCount = (src.match(/patchLatestSnapshot\(/g) ?? []).length;
    expect(writeCount, "expected the two narrative writes").toBe(2);

    // Conditions are the `if (` ... `) {` spans preceding each write.
    const guards = [...src.matchAll(/if \(([\s\S]*?)\) \{/g)].map((m) => m[1]);
    const generationGuards = guards.filter(
      (g) => g.includes("hasAi") && g.includes("consumeAiBudget"),
    );

    expect(
      generationGuards.length,
      "expected two AI-generation guards to exist",
    ).toBe(2);
    for (const g of generationGuards) {
      expect(
        g.includes("isOwner"),
        `an AI-generation guard does not require ownership: ${g.replace(/\s+/g, " ").trim()}`,
      ).toBe(true);
    }
  });

  it("still keeps the entitlement and budget checks it already had", () => {
    // The ownership gate is additional, not a replacement — dropping either of
    // these would re-open a different hole (leaking gated prose to logged-out
    // viewers, or outrunning the daily spend cap).
    expect(src).toContain("consumeAiBudget()");
    expect(src).toContain("aiInsights");
  });
});
