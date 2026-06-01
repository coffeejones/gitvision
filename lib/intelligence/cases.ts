// Server-side projection: Session → CaseItem for the Chambers "Cases"
// list. For each session's latest snapshot it computes the full verdict
// (grade / score / ruling + the four department votes) via
// computeVerdict, the headline finding, the high-severity count, and a
// stable dossier-style case number.
//
// Server-only — reads disk through lib/storage. The CaseItem shape is
// imported type-only from the (client) CaseRow component, so no client
// code is pulled into the server bundle.

import {
  computeVerdict,
  type DepartmentId,
  type Vote,
  type VerdictOutcome,
} from "./verdict";
import { pickHeadline } from "./headline";
import { extractHealthSignals } from "../signals";
import { getSession } from "../storage";
import type { CaseItem } from "@/components/chambers/CaseRow";

type DeptKey = CaseItem["departments"][number]["key"];
type DeptStatus = CaseItem["departments"][number]["status"];

const DEPT_KEY: Record<DepartmentId, DeptKey> = {
  health: "Health",
  security: "Security",
  forensics: "Forensics",
  supply: "Supply",
};
const VOTE_STATUS: Record<Vote, DeptStatus> = {
  pass: "ok",
  conditional: "warning",
  fail: "critical",
};
const OUTCOME_RULING: Record<VerdictOutcome, CaseItem["ruling"]> = {
  cleared: "Cleared",
  conditional: "Conditional",
  returned: "Returned",
};

/** Stable dossier-style case number from the session id + its creation
 *  year (FNV-1a → 4 digits). Deterministic: a case keeps its number. */
function caseNumber(id: string, createdAt: string): string {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const n = (Math.abs(h) % 9000) + 1000;
  const year = /^\d{4}/.test(createdAt) ? createdAt.slice(0, 4) : "2026";
  return `${year}-${n}`;
}

/** Project one session to a CaseItem. Null when the session or its
 *  latest snapshot is missing — nothing meaningful to file. */
export async function getCase(sessionId: string): Promise<CaseItem | null> {
  const session = await getSession(sessionId);
  if (!session) return null;
  const latest = session.snapshots[session.snapshots.length - 1];
  if (!latest) return null;

  const verdict = computeVerdict(latest);
  const headline = pickHeadline(latest);
  const signals = extractHealthSignals(latest);
  const criticalCount = signals.needsWork.filter(
    (s) => s.severity === "high",
  ).length;

  return {
    id: session.id,
    caseNo: caseNumber(session.id, session.createdAt),
    name: session.name || latest.repo.fullName,
    repoFullName: latest.repo.fullName,
    isPrivate: latest.repo.private ?? false,
    grade: verdict.grade,
    score: verdict.score,
    ruling: OUTCOME_RULING[verdict.outcome],
    criticalCount,
    snapshotCount: session.snapshots.length,
    updatedAt: session.updatedAt,
    headline: headline.primary,
    departments: verdict.rulings.map((r) => ({
      key: DEPT_KEY[r.id],
      status: VOTE_STATUS[r.vote],
    })),
  };
}

/** Project a list of session ids in parallel; individual failures are
 *  dropped so one corrupt session doesn't blank the whole list. */
export async function getCases(sessionIds: string[]): Promise<CaseItem[]> {
  const results = await Promise.all(
    sessionIds.map((id) => getCase(id).catch(() => null)),
  );
  return results.filter((c): c is CaseItem => c !== null);
}
