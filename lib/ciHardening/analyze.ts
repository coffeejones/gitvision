// CI-hardening detectors (Arc 4). Pure over workflow file CONTENTS (the fs read
// lives in index.ts), so this is fully unit-testable. Parses each workflow's
// YAML, extracts every `uses:` reference + permission scope, and runs three
// deterministic checks — action pinning, third-party inventory, token scope —
// each grounded in a named, dated incident.

import { parse as parseYaml } from "yaml";
import type {
  ActionUse,
  CIHardeningFinding,
  CIHardeningReport,
  PermissionScope,
  PinStatus,
  WorkflowPermission,
} from "./types";
import { PWN_REQUEST, REVIEWDOG, TJ_ACTIONS } from "./incidents";

/** owners treated as first-party (GitHub itself). */
const FIRST_PARTY = new Set(["actions", "github"]);

/** Classify an action's @ref. A 40-hex commit SHA is the only immutable pin. */
function classifyPin(version: string | null): PinStatus {
  if (!version) return "unknown";
  if (/^[0-9a-f]{40}$/i.test(version)) return "sha";
  // A version tag (v1, v4.1.0, 1.2.3) — mutable: the maintainer can repoint it.
  if (/^v?\d+(\.\d+)*$/.test(version)) return "tag";
  // Anything else (main, master, release/x) is a branch — the most mutable.
  return "branch";
}

/** Parse a single `uses:` value into a classified reference. */
function classifyUse(
  raw: string,
  workflow: string,
  repoOwner: string,
): ActionUse {
  if (raw.startsWith("./") || raw.startsWith("../")) {
    return { ref: raw, version: null, pin: "local", thirdParty: false, workflow };
  }
  if (raw.startsWith("docker://")) {
    return { ref: raw, version: null, pin: "docker", thirdParty: true, workflow };
  }
  const at = raw.lastIndexOf("@");
  const path = at >= 0 ? raw.slice(0, at) : raw;
  const version = at >= 0 ? raw.slice(at + 1) : null;
  const owner = (path.split("/")[0] ?? "").toLowerCase();
  const firstParty =
    FIRST_PARTY.has(owner) || (!!repoOwner && owner === repoOwner.toLowerCase());
  return {
    ref: path,
    version,
    pin: classifyPin(version),
    thirdParty: !firstParty,
    workflow,
  };
}

/** Map a raw `permissions:` value to a scope. */
function classifyPermissions(
  perms: unknown,
): { scope: PermissionScope; writes?: string[] } {
  if (perms === undefined || perms === null) return { scope: "unspecified" };
  if (perms === "read-all") return { scope: "read-all" };
  if (perms === "write-all") return { scope: "write-all" };
  if (typeof perms === "object") {
    const writes = Object.entries(perms as Record<string, unknown>)
      .filter(([, v]) => v !== "read" && v !== "none")
      .map(([k]) => k);
    return { scope: "granular", writes };
  }
  return { scope: "unspecified" };
}

interface ParsedWorkflow {
  path: string;
  uses: ActionUse[];
  permissions: WorkflowPermission[];
}

function parseWorkflow(
  path: string,
  content: string,
  repoOwner: string,
): ParsedWorkflow | null {
  let doc: unknown;
  try {
    doc = parseYaml(content);
  } catch {
    return null; // malformed YAML — skip this file rather than tank the report
  }
  if (!doc || typeof doc !== "object") return null;

  const wf = doc as Record<string, unknown>;
  const uses: ActionUse[] = [];
  const permissions: WorkflowPermission[] = [];

  // Top-level permissions (applies to every job that doesn't override).
  permissions.push({
    workflow: path,
    job: null,
    ...classifyPermissions(wf.permissions),
  });

  const jobs = (wf.jobs ?? {}) as Record<string, unknown>;
  for (const [jobName, jobRaw] of Object.entries(jobs)) {
    if (!jobRaw || typeof jobRaw !== "object") continue;
    const job = jobRaw as Record<string, unknown>;

    // A reusable-workflow call (jobs.x.uses).
    if (typeof job.uses === "string") {
      uses.push(classifyUse(job.uses, path, repoOwner));
    }
    // Per-job permissions override.
    if ("permissions" in job) {
      permissions.push({
        workflow: path,
        job: jobName,
        ...classifyPermissions(job.permissions),
      });
    }
    // Step-level actions.
    const steps = Array.isArray(job.steps) ? job.steps : [];
    for (const stepRaw of steps) {
      if (stepRaw && typeof stepRaw === "object") {
        const use = (stepRaw as Record<string, unknown>).uses;
        if (typeof use === "string") uses.push(classifyUse(use, path, repoOwner));
      }
    }
  }

  return { path, uses, permissions };
}

/** True when a workflow leaves the GITHUB_TOKEN scope open — write-all, or an
 *  unspecified TOP-LEVEL scope (which inherits the repo default, historically
 *  read/write). Per-job unspecified is fine as long as the top level is set. */
function isBroad(p: WorkflowPermission): boolean {
  return p.scope === "write-all" || (p.job === null && p.scope === "unspecified");
}

/**
 * Run the CI-hardening checks over a set of workflow files (already read from
 * disk). Returns undefined when the repo has no workflows to assess.
 */
export function analyzeWorkflows(
  files: ReadonlyArray<{ path: string; content: string }>,
  repoOwner: string,
): CIHardeningReport | undefined {
  const parsed = files
    .map((f) => parseWorkflow(f.path, f.content, repoOwner))
    .filter((w): w is ParsedWorkflow => w !== null);
  if (parsed.length === 0) return undefined;

  const actions = parsed.flatMap((w) => w.uses);
  const permissions = parsed.flatMap((w) => w.permissions);

  // Unpinned = a real action referenced by a mutable tag/branch (local/docker/
  // sha excluded). This is the tj-actions attack surface.
  const unpinned = actions.filter((a) => a.pin === "tag" || a.pin === "branch");

  const findings: CIHardeningFinding[] = [];

  // 1. Unpinned actions. Third-party unpinned is the real danger; first-party
  //    (actions/checkout@v4) is mutable too but GitHub-owned, so it's lower.
  if (unpinned.length > 0) {
    const thirdPartyUnpinned = unpinned.filter((a) => a.thirdParty);
    findings.push({
      id: "unpinned-actions",
      severity: thirdPartyUnpinned.length > 0 ? "high" : "medium",
      title:
        thirdPartyUnpinned.length > 0
          ? `${thirdPartyUnpinned.length} third-party action${
              thirdPartyUnpinned.length === 1 ? " is" : "s are"
            } pinned to a mutable tag/branch`
          : `${unpinned.length} action${
              unpinned.length === 1 ? " is" : "s are"
            } pinned to a mutable tag, not a commit SHA`,
      count: unpinned.length,
      evidence: unpinned
        .slice(0, 12)
        .map((a) => `${a.ref}@${a.version ?? "?"} in ${a.workflow}`),
      incident: TJ_ACTIONS,
    });
  }

  // 2. Third-party action inventory — the supply-chain surface.
  const thirdParty = actions.filter((a) => a.thirdParty && a.pin !== "docker");
  const distinctThirdParty = [...new Set(thirdParty.map((a) => a.ref))];
  if (distinctThirdParty.length > 0) {
    findings.push({
      id: "third-party-actions",
      severity: "low",
      title: `${distinctThirdParty.length} distinct third-party action${
        distinctThirdParty.length === 1 ? "" : "s"
      } in the supply chain`,
      count: distinctThirdParty.length,
      evidence: distinctThirdParty.slice(0, 12),
      incident: REVIEWDOG,
    });
  }

  // 3. Broad GITHUB_TOKEN scope.
  const broad = permissions.filter(isBroad);
  if (broad.length > 0) {
    const writeAll = broad.filter((p) => p.scope === "write-all");
    findings.push({
      id: "broad-permissions",
      severity: writeAll.length > 0 ? "high" : "medium",
      title:
        writeAll.length > 0
          ? `${writeAll.length} workflow${
              writeAll.length === 1 ? "" : "s"
            } grant the token write-all`
          : `${broad.length} workflow${
              broad.length === 1 ? "" : "s"
            } leave the token scope unset (inherits the broad repo default)`,
      count: broad.length,
      evidence: broad.map((p) =>
        p.scope === "write-all"
          ? `write-all in ${p.workflow}${p.job ? ` (job: ${p.job})` : ""}`
          : `no permissions block in ${p.workflow}`,
      ),
      incident: PWN_REQUEST,
    });
  }

  const order = { high: 0, medium: 1, low: 2 } as const;
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  const posture: CIHardeningReport["posture"] = findings.some(
    (f) => f.severity === "high",
  )
    ? "exposed"
    : findings.some((f) => f.severity === "medium")
      ? "attention"
      : "hardened";

  return {
    workflowCount: parsed.length,
    actions,
    unpinned,
    permissions,
    findings,
    posture,
  };
}
