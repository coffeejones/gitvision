// Deterministic guidance for the workspace goal launcher.
//
// A brief item can be useful without earning the right to steer the reader.
// The launcher therefore has no fallback recommendation and no hidden score:
// composers explicitly opt one item in by attaching the rule it crossed. If
// nothing crosses a rule, the four user goals stay neutral and equal.

import type { AnalysisSnapshot } from "../types";
import { buildBrief } from "./index";
import {
  getWorkspaceGoals,
  withBriefContext,
  type WorkspaceGoal,
} from "./goals";
import {
  SUBJECT_IDS,
  type Brief,
  type BriefItem,
  type SubjectId,
} from "./types";

export interface GuidedWorkspaceGoal extends WorkspaceGoal {
  insight: string;
}

export interface WorkspaceRecommendation {
  kind: "action" | "review";
  goalId: SubjectId;
  label: "Actionable finding" | "Needs human review";
  title: string;
  finding: string;
  why: string;
  suggestedAction: string;
  evidenceHref: string;
  answerHref: string;
}

export interface WorkspaceGoalGuidance {
  recommendation: WorkspaceRecommendation | null;
  goals: GuidedWorkspaceGoal[];
}

type Briefs = Record<SubjectId, Brief>;

interface RecommendationCandidate {
  goalId: SubjectId;
  item: BriefItem & { recommendation: NonNullable<BriefItem["recommendation"]> };
}

function firstRecommendedItem(
  brief: Brief,
  kind?: NonNullable<BriefItem["recommendation"]>["kind"],
): RecommendationCandidate["item"] | null {
  for (const section of brief.sections) {
    for (const item of section.items) {
      if (
        item.recommendation &&
        (kind === undefined || item.recommendation.kind === kind)
      ) {
        return item as RecommendationCandidate["item"];
      }
    }
  }
  return null;
}

/** Selection is categorical and intentionally allowed to return `null`.
 *
 *  1. A literal secret or exact public-advisory match is actionable.
 *  2. A load-bearing untested file may earn a bounded review recommendation.
 *  3. A traced security path or incident-range match may earn human review.
 *
 * Pattern matches, outdated packages, duplicates, coverage gaps and empty
 * briefs do not qualify. They remain visible inside the goals and workspace.
 */
export function selectWorkspaceRecommendation(
  briefs: Briefs,
): RecommendationCandidate | null {
  const securityAction = firstRecommendedItem(briefs.security, "action");
  if (securityAction) {
    return { goalId: "security", item: securityAction };
  }

  const improveReview = firstRecommendedItem(briefs.improve, "review");
  if (improveReview) {
    return { goalId: "improve", item: improveReview };
  }

  const securityReview = firstRecommendedItem(briefs.security, "review");
  if (securityReview) {
    return { goalId: "security", item: securityReview };
  }

  return null;
}

export function buildWorkspaceGoalGuidance(
  snapshot: AnalysisSnapshot,
  sessionId: string,
): WorkspaceGoalGuidance {
  const briefs = Object.fromEntries(
    SUBJECT_IDS.map((subject) => [
      subject,
      buildBrief(subject, snapshot, sessionId),
    ]),
  ) as Briefs;
  const candidate = selectWorkspaceRecommendation(briefs);
  const functionCount = snapshot.codeGraph?.functions.length ?? 0;

  const goals = getWorkspaceGoals(sessionId).map(
    (goal): GuidedWorkspaceGoal => {
      if (goal.id === "change") {
        return {
          ...goal,
          insight:
            functionCount > 0
              ? `${functionCount.toLocaleString()} functions are mapped and ready for a file-level impact check.`
              : "Choose a file to see what depends on it and where the analysis becomes uncertain.",
        };
      }

      return {
        ...goal,
        insight: briefs[goal.id].answer,
      };
    },
  );

  if (!candidate) {
    return { recommendation: null, goals };
  }

  const { goalId, item } = candidate;
  return {
    recommendation: {
      kind: item.recommendation.kind,
      goalId,
      label:
        item.recommendation.kind === "action"
          ? "Actionable finding"
          : "Needs human review",
      title: item.title,
      finding: item.evidence,
      why: item.recommendation.why,
      suggestedAction: item.recommendation.suggestedAction,
      evidenceHref: withBriefContext(item.href, goalId),
      answerHref:
        goals.find((goal) => goal.id === goalId)?.href ??
        `/session/${sessionId}/brief/${goalId}`,
    },
    goals,
  };
}
