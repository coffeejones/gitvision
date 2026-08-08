// Three questions, one shape, one registry.
//
// The first cut shipped a single subject behind a hardcoded sidebar link, which
// made a third of a feature look like a finished one — there was no way to see
// that the other questions existed. These tests hold the two things that stops
// happening again: the registry is the only list, and every subject it names
// actually produces something on a real repo.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { AnalysisSnapshot } from "../types";
import {
  buildBrief,
  SUBJECTS,
  SUBJECT_IDS,
  isSubjectId,
  type Brief,
} from "../brief";

const session = (id: string): AnalysisSnapshot =>
  JSON.parse(
    readFileSync(
      path.join(process.cwd(), ".gitvision", "sessions", `${id}.json`),
      "utf-8",
    ),
  ).snapshots.at(-1);

const items = (b: Brief) => b.sections.flatMap((s) => s.items);

/** One repo per shape: a Go repo we cannot check, a Python one we can, a
 *  TypeScript application, and a TypeScript library. */
const REPOS = [
  ["gx1lLA07kO", "gin-gonic/gin"],
  ["yAwwHY_ShB", "pallets/flask"],
  ["o5QTmaYTwE", "coffeejones/gitvision"],
  ["DBtU3d_Gfk", "colinhacks/zod"],
] as const;

describe("the registry is the only list of subjects", () => {
  it("names three, and each crosses more than one tab", () => {
    // A subject earns a slot by composing across surfaces. "Refactor" and
    // "Tests" are each a single existing tab — as subjects they would be a menu
    // entry pointing at a menu entry, which is the problem this solves.
    expect(SUBJECT_IDS).toEqual(["security", "understand", "improve"]);
    for (const id of SUBJECT_IDS) {
      expect(
        SUBJECTS[id].question.endsWith("?"),
        `${id} is not phrased as a question`,
      ).toBe(true);
      expect(
        SUBJECTS[id].title.length,
        `${id} has no goal title`,
      ).toBeGreaterThan(20);
      expect(
        SUBJECTS[id].category.length,
        `${id} has no category`,
      ).toBeGreaterThan(5);
      expect(SUBJECTS[id].blurb.length, `${id} has no blurb`).toBeGreaterThan(
        20,
      );
      expect(
        SUBJECTS[id].footnote.length,
        `${id} has no footnote`,
      ).toBeGreaterThan(5);
    }
  });

  it("rejects anything not in it", () => {
    expect(isSubjectId("security")).toBe(true);
    expect(isSubjectId("refactor")).toBe(false);
    expect(isSubjectId("")).toBe(false);
    expect(isSubjectId("__proto__"), "prototype keys are not subjects").toBe(
      false,
    );
  });

  it("is reachable from the UI — the sidebar and the palette both point at it", () => {
    // The bug that prompted this file: the brief existed and only one third of
    // it could be reached.
    const shell = readFileSync(
      path.join(process.cwd(), "components", "SessionShell.tsx"),
      "utf-8",
    );
    const palette = readFileSync(
      path.join(process.cwd(), "components", "CommandPalette.tsx"),
      "utf-8",
    );
    expect(shell).toContain("/brief");
    expect(palette).toContain("/brief");
    // And neither may hardcode a subject's question as its label — that is what
    // made one subject look like the whole feature.
    for (const [name, src] of [
      ["SessionShell", shell],
      ["CommandPalette", palette],
    ] as const) {
      expect(
        src,
        `${name} labels the entry with one subject's question`,
      ).not.toContain(SUBJECTS.security.question);
    }
  });
});

describe("every subject answers on a real repo", () => {
  it.each(
    SUBJECT_IDS.flatMap((s) =>
      REPOS.map(([id, name]) => [s, id, name] as const),
    ),
  )("%s on %s", (subject, id) => {
    const brief = buildBrief(subject, session(id), "s1");

    expect(brief.subject).toBe(subject);
    expect(brief.question).toBe(SUBJECTS[subject].question);
    expect(brief.intro.length, "no intro").toBeGreaterThan(30);

    // A section that survived assemble() has items; empty ones are dropped, so
    // the page never renders a heading over nothing.
    for (const s of brief.sections) {
      expect(
        s.items.length,
        `${subject}/${id}: empty section ${s.id} survived`,
      ).toBeGreaterThan(0);
      expect(
        s.note.length,
        `${subject}/${id}: section ${s.id} has no note`,
      ).toBeGreaterThan(15);
    }

    for (const item of items(brief)) {
      expect(item.title.length, `${subject}/${id}/${item.id}`).toBeGreaterThan(
        3,
      );
      expect(
        item.evidence,
        `${subject}/${id}/${item.id} left a placeholder`,
      ).not.toMatch(/undefined|NaN|\[object/);
      expect(
        item.href,
        `${subject}/${id}/${item.id} has nowhere to verify it`,
      ).toMatch(/^\/session\/s1\//);
    }

    // Ids must be unique — a collision makes React drop an item silently, and
    // it happened for real on file+line keys.
    const ids = items(brief).map((i) => i.id);
    expect(new Set(ids).size, `${subject}/${id} has duplicate ids`).toBe(
      ids.length,
    );
  });

  it("produces something on every subject for at least one repo", () => {
    // Guards against a composer that silently returns nothing everywhere —
    // which would render as a permanent "nothing found" and look intentional.
    for (const subject of SUBJECT_IDS) {
      const any = REPOS.some(
        ([id]) => items(buildBrief(subject, session(id), "s1")).length > 0,
      );
      expect(any, `${subject} produced no items on any real repo`).toBe(true);
    }
  });
});

describe("clean is earned, on every subject", () => {
  it.each(SUBJECT_IDS)("%s never calls an unchecked repo clean", (subject) => {
    // gin-gonic/gin: no dependency reader, no dangerous-call rules. Whatever a
    // subject finds there, it may not report the absence as safety.
    const brief = buildBrief(subject, session("gx1lLA07kO"), "s1");
    if (brief.gaps.some((g) => g.kind === "blocking")) {
      expect(brief.clean, `${subject} called a blocked repo clean`).toBe(false);
    }
  });

  it("phrases its own empty state per subject", () => {
    // "Nothing found" means something different for each question, and a shared
    // sentence would be wrong for two of the three.
    const empty = {} as unknown as AnalysisSnapshot;
    const lines = SUBJECT_IDS.map(
      (s) => buildBrief(s, empty, "s1").emptyHeadline,
    );
    expect(new Set(lines).size, "two subjects share an empty state").toBe(
      lines.length,
    );
  });

  it("survives a snapshot with nothing on it", () => {
    // Old sessions on disk must keep rendering (AGENTS.md invariant 2).
    const empty = {} as unknown as AnalysisSnapshot;
    for (const s of SUBJECT_IDS) {
      expect(() => buildBrief(s, empty, "s1"), s).not.toThrow();
      expect(items(buildBrief(s, empty, "s1")), s).toEqual([]);
    }
  });
});
