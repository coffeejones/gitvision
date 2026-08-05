// The reading is allowed to exist only because it cannot say more than the
// findings do — and because it is TOLD what it could not see.
//
// lib/healthAnalysis.ts instructs its model to write "No pressing risks
// surfaced in the current data" when a bucket is empty. On a Go repo — no
// dependency reader, no dangerous-call rules — that sentence is technically
// defensible and reads as "you are fine". A brief that composes three tabs and
// then says it with confidence is WORSE than the three tabs, because the reader
// loses the chance to notice the empty Packages panel for themselves.
//
// So these tests hold two things:
//   1. the gaps actually reach the request payload, not just the prompt text
//   2. the prompt forbids the reassuring phrasings by name
//
// The model is not called here. What can be checked deterministically is what
// we send it and what we tell it, and that is what fails first when someone
// "simplifies" the payload later.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { AnalysisSnapshot } from "../types";
import { buildBrief, SUBJECT_IDS } from "../brief";
import { buildReadingInput } from "../brief/reading";

const session = (id: string): AnalysisSnapshot =>
  JSON.parse(
    readFileSync(path.join(process.cwd(), ".gitvision", "sessions", `${id}.json`), "utf-8"),
  ).snapshots.at(-1);

const readingSrc = readFileSync(
  path.join(process.cwd(), "lib", "brief", "reading.ts"),
  "utf-8",
);

describe("the model is told what could not be checked", () => {
  it("puts the gaps in the payload, not just in the prompt", () => {
    // gin-gonic/gin: no dependency reader, no dangerous-call rules, no
    // findings. If the gaps do not travel, the model sees an empty brief and
    // has no way to know that is silence rather than safety.
    const snap = session("gx1lLA07kO");
    const input = buildReadingInput(buildBrief("security", snap, "s1"), snap) as {
      sections: unknown[];
      gaps: { headline: string; blocking: boolean }[];
    };

    expect(input.sections, "gin has findings? re-pick the fixture").toEqual([]);
    expect(input.gaps.length, "the gaps did not reach the payload").toBeGreaterThan(0);
    expect(input.gaps.some((g) => g.blocking), "no gap marked blocking").toBe(true);
    // And the headline must be the real, specific one — not a category name.
    expect(input.gaps.map((g) => g.headline).join(" ")).toContain("go.mod");
  });

  it("marks blocking gaps differently from bounding ones", () => {
    // "We could not check your dependencies" and "this count is a floor" are
    // not the same claim, and a model handed one flat list would blur them.
    const snap = session("gx1lLA07kO");
    const input = buildReadingInput(buildBrief("security", snap, "s1"), snap) as {
      gaps: { blocking: boolean }[];
    };
    expect(input.gaps.every((g) => typeof g.blocking === "boolean")).toBe(true);
  });

  it("carries evidence, not just titles", () => {
    const snap = session("yAwwHY_ShB");
    const input = buildReadingInput(buildBrief("security", snap, "s1"), snap) as {
      sections: { items: { title: string; evidence: string }[] }[];
    };
    const items = input.sections.flatMap((s) => s.items);
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      expect(i.evidence.length, `${i.title} travelled without its evidence`).toBeGreaterThan(10);
    }
    // The advisory ids are the corroborator. Without them the model can only
    // paraphrase, and a paraphrase of a CVE is not evidence.
    expect(JSON.stringify(items)).toMatch(/GHSA-|CVE-/);
  });

  it("sends nothing the brief did not already show", () => {
    // The payload is the page. If it ever carried something the reader cannot
    // see, the reading would be unauditable — which is the whole objection to
    // AI summaries this product exists to answer.
    const snap = session("yAwwHY_ShB");
    const brief = buildBrief("security", snap, "s1");
    const input = buildReadingInput(brief, snap) as Record<string, unknown>;
    expect(Object.keys(input).sort()).toEqual(["gaps", "question", "repository", "sections"]);
  });

  it("works for every subject", () => {
    const snap = session("o5QTmaYTwE");
    for (const s of SUBJECT_IDS) {
      const input = buildReadingInput(buildBrief(s, snap, "s1"), snap) as { question: string };
      expect(input.question.endsWith("?"), s).toBe(true);
    }
  });
});

describe("the prompt forbids the reassuring phrasings by name", () => {
  it("requires the gaps to be stated, above brevity", () => {
    expect(readingSrc).toMatch(/IF "gaps" IS NON-EMPTY YOU MUST SAY SO/);
    expect(readingSrc).toContain("This outranks brevity");
  });

  it("names the exact sentences that would read as a clean bill of health", () => {
    // Naming them is the point. "Be careful" is not an instruction a model can
    // follow; "never write 'no issues found'" is.
    for (const banned of ["no issues found", "looks clean", "nothing concerning"]) {
      expect(readingSrc, `the prompt does not forbid "${banned}"`).toContain(banned);
    }
  });

  it("holds the product's two standing lines", () => {
    // A pattern match is not a vulnerability, and reachability is not
    // execution. Both are load-bearing claims the rest of the product keeps.
    expect(readingSrc).toContain("Never call a pattern match a vulnerability");
    expect(readingSrc).toMatch(/proves reachability, not execution/);
  });

  it("refuses to invent", () => {
    expect(readingSrc).toMatch(/Never invent a finding/);
  });
});

describe("it stays an enhancement", () => {
  it("returns null with no API key, rather than throwing", async () => {
    // The brief must be fully usable for self-hosters and demos. A reading that
    // threw here would take the page down with it.
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const { generateBriefReading } = await import("../brief/reading");
      const snap = session("yAwwHY_ShB");
      await expect(
        generateBriefReading(buildBrief("security", snap, "s1"), snap),
      ).resolves.toBeNull();
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  it("hides itself rather than offering a button that cannot work", () => {
    const panel = readFileSync(
      path.join(process.cwd(), "components", "views", "BriefReadingPanel.tsx"),
      "utf-8",
    );
    expect(panel).toContain("if (!available && !reading) return null;");
    // And a public demo must never show a control that spends the owner's
    // budget — same rule the health panel keeps.
    expect(panel).toContain("readOnly");
  });

  it("caches per subject so one question does not bill for three", () => {
    const route = readFileSync(
      path.join(process.cwd(), "app", "api", "sessions", "[id]", "brief", "[subject]", "route.ts"),
      "utf-8",
    );
    expect(route).toContain("briefReadings");
    // Merge, never replace — the other two readings must survive.
    expect(route).toMatch(/\.\.\.\(snap\.briefReadings \?\? \{\}\)/);
  });

  it("composes the brief server-side instead of trusting the caller", () => {
    // A client could otherwise post a brief with the gaps stripped out and get
    // back a confident, clean-sounding paragraph about an unchecked repo.
    const route = readFileSync(
      path.join(process.cwd(), "app", "api", "sessions", "[id]", "brief", "[subject]", "route.ts"),
      "utf-8",
    );
    expect(route).toContain("buildBrief(subject, snap, id)");
    expect(route, "the route reads a brief from the request body").not.toMatch(/await req\.json\(\)/);
  });

  it("spends money only for an owner, on a gated tier, within a budget", () => {
    const route = readFileSync(
      path.join(process.cwd(), "app", "api", "sessions", "[id]", "brief", "[subject]", "route.ts"),
      "utf-8",
    );
    expect(route).toContain("requireSessionOwnership");
    expect(route).toContain("requireAiInsights");
    expect(route).toContain("consumeAiBudget");
  });
});
