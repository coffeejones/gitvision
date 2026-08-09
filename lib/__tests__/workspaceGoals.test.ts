import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { AnalysisSnapshot } from "../types";
import type {
  Brief,
  BriefItem,
  BriefSection,
  SubjectId,
} from "../brief/types";
import {
  buildWorkspaceGoalGuidance,
  selectWorkspaceRecommendation,
} from "../brief/guidance";
import { getWorkspaceGoals, withBriefContext } from "../brief/goals";
import { qualifiesForImproveRecommendation } from "../brief/improve";
import { loadSnapshot } from "./helpers/sessionFixture";

// Through the fixture loader, never straight off the gitignored session
// directory — reading that directly passes on the machine that captured the
// analysis and throws ENOENT on CI. It did: run 31256876872 went red on
// PGlVvQRlAh.json the day after the fixtures were committed to stop exactly
// this. lib/__tests__/fixtureDiscipline.test.ts now holds the line.
const session = (id: string): AnalysisSnapshot => loadSnapshot<AnalysisSnapshot>(id);

function brief(
  subject: SubjectId,
  sectionId?: string,
  recommendation?: NonNullable<BriefItem["recommendation"]>,
  blocking = false,
): Brief {
  const sections: BriefSection[] = sectionId
    ? [
        {
          id: sectionId,
          label: sectionId,
          note: "Deterministic section used to test recommendation priority.",
          items: [
            {
              id: `${subject}:${sectionId}`,
              soWhat: "This is the evidenced consequence.",
              title: "lib/example.ts",
              evidence: "Three files depend on it.",
              href: "/session/s1/code",
              recommendation,
            },
          ],
        },
      ]
    : [];
  return {
    subject,
    question: "What should I do?",
    answer: "A deterministic answer.",
    howToRead: "Read the evidence.",
    intro: "Composed from existing workspace findings.",
    sections,
    gaps: blocking
      ? [
          {
            id: "security-no-rules",
            surface: "session",
            kind: "blocking",
            headline: "A check could not run.",
            detail: "The result is bounded.",
            numbers: {},
          },
        ]
      : [],
    emptyHeadline: "Nothing outstanding.",
    emptyDetail: "The checks ran and found nothing.",
    clean: sections.length === 0 && !blocking,
  };
}

const action = {
  kind: "action",
  why: "An exact published advisory matched this version.",
  suggestedAction: "Review the advisory and update the dependency.",
} as const;

const review = {
  kind: "review",
  why: "The finding crossed a documented structural threshold.",
  suggestedAction: "Inspect the evidence before changing the code.",
} as const;

function briefs({
  security = brief("security"),
  improve = brief("improve"),
}: {
  security?: Brief;
  improve?: Brief;
} = {}) {
  return {
    security,
    understand: brief("understand"),
    improve,
  };
}

describe("workspace goals", () => {
  it("offers three cross-surface briefs and one target-first change flow", () => {
    const goals = getWorkspaceGoals("s1");

    expect(goals.map((goal) => goal.id)).toEqual([
      "security",
      "understand",
      "improve",
      "change",
    ]);
    expect(goals.slice(0, 3).map((goal) => goal.href)).toEqual([
      "/session/s1/brief/security",
      "/session/s1/brief/understand",
      "/session/s1/brief/improve",
    ]);
    expect(goals[3]).toMatchObject({
      href: "/session/s1/faultline?goal=change",
    });
  });

  it("only recommends items that explicitly earned workspace attention", () => {
    const candidate = selectWorkspaceRecommendation(
      briefs({ security: brief("security", "fix") }),
    );

    expect(candidate).toBeNull();
    expect(
      selectWorkspaceRecommendation(
        briefs({ security: brief("security", "fix", action) }),
      ),
    ).toMatchObject({ goalId: "security", item: { recommendation: action } });
  });

  it("uses categorical priority without inventing a score", () => {
    expect(
      selectWorkspaceRecommendation(
        briefs({
          security: brief("security", "fix", action),
          improve: brief("improve", "risky", review),
        }),
      )?.goalId,
    ).toBe("security");
    expect(
      selectWorkspaceRecommendation(
        briefs({
          security: brief("security", "investigate", review),
          improve: brief("improve", "risky", review),
        }),
      )?.goalId,
    ).toBe("improve");
    expect(
      selectWorkspaceRecommendation(
        briefs({ security: brief("security", "investigate", review) }),
      )?.goalId,
    ).toBe("security");
  });

  it("does not turn gaps, ordinary findings or an empty brief into intent", () => {
    expect(
      selectWorkspaceRecommendation(
        briefs({ security: brief("security", undefined, undefined, true) }),
      ),
    ).toBeNull();
    expect(
      selectWorkspaceRecommendation(
        briefs({ improve: brief("improve", "duplicated") }),
      ),
    ).toBeNull();
    expect(selectWorkspaceRecommendation(briefs())).toBeNull();
  });

  it("requires a leading hotspot with ten dependents and half untested", () => {
    expect(
      qualifiesForImproveRecommendation(
        { dependents: 10, untestedDependents: 5 },
        0,
      ),
    ).toBe(true);
    expect(
      qualifiesForImproveRecommendation(
        { dependents: 9, untestedDependents: 9 },
        0,
      ),
    ).toBe(false);
    expect(
      qualifiesForImproveRecommendation(
        { dependents: 10, untestedDependents: 4 },
        0,
      ),
    ).toBe(false);
    expect(
      qualifiesForImproveRecommendation(
        { dependents: 40, untestedDependents: 40 },
        1,
      ),
    ).toBe(false);
  });

  it("explains the real recommendation and keeps four equal goal previews", () => {
    const guidance = buildWorkspaceGoalGuidance(session("o5QTmaYTwE"), "s1");

    expect(guidance.goals).toHaveLength(4);
    expect(guidance.recommendation).toMatchObject({
      kind: "review",
      goalId: "improve",
      label: "Needs human review",
      title: "lib/theme.ts",
      evidenceHref:
        "/session/s1/refactor?file=lib%2Ftheme.ts&from=brief&subject=improve#selected-file",
      answerHref: "/session/s1/brief/improve",
    });
    expect(guidance.recommendation?.finding).toContain("38 files depend on it");
    expect(guidance.recommendation?.why).toContain("10-dependent");
    expect(guidance.recommendation?.suggestedAction).toContain("Inspect");
    for (const goal of guidance.goals) {
      expect(
        goal.insight.length,
        `${goal.id} has no snapshot insight`,
      ).toBeGreaterThan(15);
    }
  });

  it("keeps the launcher neutral when no finding crosses a rule", () => {
    const guidance = buildWorkspaceGoalGuidance(session("PGlVvQRlAh"), "s1");

    expect(guidance.recommendation).toBeNull();
    expect(guidance.goals).toHaveLength(4);
  });

  it("carries brief context without dropping an evidence deep-link", () => {
    expect(
      withBriefContext("/session/s1/code?file=lib%2Fstorage.ts", "understand"),
    ).toBe(
      "/session/s1/code?file=lib%2Fstorage.ts&from=brief&subject=understand",
    );
    expect(
      withBriefContext(
        "/session/s1/refactor?file=lib%2Ftheme.ts#selected-file",
        "improve",
      ),
    ).toBe(
      "/session/s1/refactor?file=lib%2Ftheme.ts&from=brief&subject=improve#selected-file",
    );
  });

  it("stays behind an explicit goal choice instead of taking over Overview", () => {
    const overview = readFileSync(
      path.join(process.cwd(), "app", "session", "[id]", "page.tsx"),
      "utf8",
    );
    const chooser = readFileSync(
      path.join(
        process.cwd(),
        "app",
        "session",
        "[id]",
        "brief",
        "page.tsx",
      ),
      "utf8",
    );

    expect(overview).not.toContain("<GuidedGoalPicker");
    expect(overview).not.toContain("buildWorkspaceGoalGuidance");
    expect(chooser).toContain("<GuidedGoalPicker");
    expect(chooser).toContain("buildWorkspaceGoalGuidance");
  });
});
