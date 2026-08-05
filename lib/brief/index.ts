// The subject registry — one place that knows which questions exist.
//
// A page asks for a subject and gets a Brief; it never knows which composer
// answered. That is what makes adding a fourth subject a file rather than a
// redesign, and it is why the route can validate against SUBJECT_IDS instead
// of a list it keeps in sync by hand.

import type { AnalysisSnapshot } from "../types";
import { buildSecurityBrief } from "./security";
import { buildUnderstandBrief } from "./understand";
import { buildImproveBrief } from "./improve";
import type { Brief, SubjectId } from "./types";

const COMPOSERS: Record<
  SubjectId,
  (snap: AnalysisSnapshot, sessionId: string) => Brief
> = {
  security: buildSecurityBrief,
  understand: buildUnderstandBrief,
  improve: buildImproveBrief,
};

export function buildBrief(
  subject: SubjectId,
  snap: AnalysisSnapshot,
  sessionId: string,
): Brief {
  return COMPOSERS[subject](snap, sessionId);
}

export * from "./types";
