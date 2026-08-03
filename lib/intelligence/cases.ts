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
  verdictFor,
  criticalCountFor,
  type DepartmentId,
  type Vote,
  type VerdictOutcome,
} from "./verdict";
import { diffVerdict } from "./verdictDelta";
import { pickHeadline } from "./headline";
import { extractHealthSignals } from "../signals";
import { getSession } from "../storage";
import type { AnalysisSnapshot } from "../types";
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
export async function getCase(
  sessionId: string,
  /** fetchedAt of the snapshot the viewing user last SAW for this case
   *  (from their seen-map). The delta is measured against this baseline,
   *  not the previous snapshot — so a case stops showing movement once the
   *  user has opened it, and shows it again only when something new lands.
   *  Undefined → never opened → no delta. */
  seenFetchedAt?: string,
): Promise<CaseItem | null> {
  const session = await getSession(sessionId);
  if (!session) return null;
  const latest = session.snapshots[session.snapshots.length - 1];
  if (!latest) return null;

  const verdict = computeVerdict(latest);
  const headline = pickHeadline(latest);
  const criticalCount = criticalCountFor(latest);

  // "Since you last looked" — diff the latest verdict against the snapshot
  // the user last SAW (their seen baseline), advanced when they open the
  // case detail. No baseline (never opened) or a baseline that's already
  // the latest (nothing new since) → no delta, so a case you've reviewed
  // shows no movement line until it actually changes.
  let delta: CaseItem["delta"];
  const baseline =
    seenFetchedAt && seenFetchedAt !== latest.fetchedAt
      ? session.snapshots.find((s) => s.fetchedAt === seenFetchedAt)
      : undefined;
  if (baseline) {
    const raw = diffVerdict(
      verdictFor(baseline),
      verdict,
      criticalCountFor(baseline),
      criticalCount,
    );
    delta = {
      direction: raw.direction,
      grade: raw.grade,
      scoreDelta: raw.scoreDelta,
      criticalDelta: raw.criticalDelta,
      departments: raw.departments.map((d) => ({
        key: DEPT_KEY[d.id],
        from: VOTE_STATUS[d.from],
        to: VOTE_STATUS[d.to],
      })),
    };
  }

  return {
    id: session.id,
    caseNo: caseNumber(session.id, session.createdAt),
    name: session.name || latest.repo.fullName,
    repoFullName: latest.repo.fullName,
    isPrivate: latest.repo.private ?? false,
    // Only set for non-default branches, so the row carries a chip that
    // distinguishes several sessions of the same repo. Default-branch
    // sessions stay chip-free.
    branch: latest.analyzedRef,
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
    delta,
  };
}

/** Project a list of session ids in parallel; individual failures are
 *  dropped so one corrupt session doesn't blank the whole list. */
export async function getCases(
  sessionIds: string[],
  /** Per-user seen-map (sessionId → last-seen fetchedAt). Drives each
   *  case's since-last-visit delta. Defaults to empty (anonymous / no
   *  history) → no deltas. */
  seenMap: Record<string, string> = {},
): Promise<CaseItem[]> {
  const results = await Promise.all(
    sessionIds.map((id) => getCase(id, seenMap[id]).catch(() => null)),
  );
  return results.filter((c): c is CaseItem => c !== null);
}
