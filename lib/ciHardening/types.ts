// CI-hardening report types (Arc 4 — Evidence Desk). Client-safe: no fs / yaml
// imports, so the panel can import these without pulling the parser into the
// client bundle.

/** How an action reference is pinned. A 40-char commit SHA is immutable (safe);
 *  a tag or branch is mutable — the attacker-movable surface. */
export type PinStatus = "sha" | "tag" | "branch" | "local" | "docker" | "unknown";

/** A single `uses:` reference found in a workflow. */
export interface ActionUse {
  /** owner/repo (or the raw value for local/docker uses). */
  ref: string;
  /** The @-suffix (a SHA, tag, or branch), or null when absent. */
  version: string | null;
  pin: PinStatus;
  /** True when the action is neither first-party (actions/*, github/*) nor
   *  owned by the repo itself — i.e. third-party supply-chain surface. */
  thirdParty: boolean;
  /** Workflow file (repo-relative) this reference appears in. */
  workflow: string;
}

/** The effective permission scope of a workflow or job's GITHUB_TOKEN. */
export type PermissionScope =
  | "read-all" // permissions: read-all → minimal, good
  | "write-all" // permissions: write-all → broad, risky
  | "granular" // an explicit map (some writes)
  | "unspecified"; // no permissions key → inherits the repo default (often broad)

export interface WorkflowPermission {
  /** Workflow file (repo-relative). */
  workflow: string;
  /** Job name for a per-job block; null for the top-level block. */
  job: string | null;
  scope: PermissionScope;
  /** For a granular scope: the keys granted write/other non-read access. */
  writes?: string[];
}

/** A named, dated real-world incident used to ground a check in why it matters
 *  — never a bare "best practice". */
export interface CIIncident {
  name: string;
  /** ISO date the incident became public. */
  date: string;
  url?: string;
  /** One-line "what happened", grounded and specific. */
  summary: string;
}

export interface CIHardeningFinding {
  id: "unpinned-actions" | "third-party-actions" | "broad-permissions";
  severity: "high" | "medium" | "low";
  title: string;
  /** How many occurrences drive this finding. */
  count: number;
  /** Concrete evidence rows (e.g. "tj-actions/changed-files@v35 in ci.yml"). */
  evidence: string[];
  /** The named, dated incident motivating the check. */
  incident?: CIIncident;
}

export interface CIHardeningReport {
  /** Workflow files parsed. */
  workflowCount: number;
  /** Every `uses:` reference (the full action inventory). */
  actions: ActionUse[];
  /** The subset that is unpinned (tag/branch) — the movable attack surface. */
  unpinned: ActionUse[];
  /** Permission scopes found across workflows/jobs. */
  permissions: WorkflowPermission[];
  /** Deterministic findings, most-severe first. */
  findings: CIHardeningFinding[];
  /** Overall posture derived from the findings' severities. */
  posture: "hardened" | "attention" | "exposed";
}
