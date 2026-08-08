// Workspace goals are navigation, not a second analysis layer.
//
// Three goals lead to deterministic briefs that compose findings across
// workspace surfaces. The change goal leads to Faultline, because it needs a
// concrete file from the user before CodeTrawl can answer honestly. Keeping
// that distinction here prevents a fake generic "change plan" from creeping
// into the brief composers.

import { SUBJECT_IDS, SUBJECTS, type SubjectId } from "./types";

export type WorkspaceGoalId = SubjectId | "change";

export interface WorkspaceGoal {
  id: WorkspaceGoalId;
  title: string;
  category: string;
  description: string;
  footnote: string;
  href: string;
}

export function getWorkspaceGoals(sessionId: string): WorkspaceGoal[] {
  const base = `/session/${sessionId}`;
  const briefs = SUBJECT_IDS.map((id) => ({
    id,
    title: SUBJECTS[id].title,
    category: SUBJECTS[id].category,
    description: SUBJECTS[id].blurb,
    footnote: SUBJECTS[id].footnote,
    href: `${base}/brief/${id}`,
  }));

  return [
    ...briefs,
    {
      id: "change",
      title: "Plan a change safely",
      category: "Impact + tests",
      description:
        "Pick a file and simulate what depends on it, which tests guard it and where the map becomes uncertain.",
      footnote: "Faultline · evidence · blind spots",
      href: `${base}/faultline?goal=change`,
    },
  ];
}

/** Preserve an evidence link's existing query while carrying the guided brief
 *  context into the owning workspace surface. */
export function withBriefContext(href: string, subject: SubjectId): string {
  const [withoutHash, hash = ""] = href.split("#", 2);
  const [path, raw = ""] = withoutHash.split("?", 2);
  const params = new URLSearchParams(raw);
  params.set("from", "brief");
  params.set("subject", subject);
  return `${path}?${params.toString()}${hash ? `#${hash}` : ""}`;
}
