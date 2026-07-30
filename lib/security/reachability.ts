// Reachability filter — the differentiator (v0.82+).
//
// A sink is a dangerous operation. Whether it MATTERS depends on whether
// untrusted input can get to it, and that is a graph question, not a pattern
// question. This module answers it: for every sink the plugins found, is there
// a path from a function the outside world can trigger?
//
// ─────────────────────────────────────────────────────────────────────────────
// FOUR STATES, AND WHY NOT TWO. Read this before changing the classification.
//
// The tempting design is reachable / not-reachable, because it produces the
// best headline number. It is also the one way this feature can do real harm:
// "no path found" has two completely different causes, and collapsing them
// hides vulnerabilities precisely where the code is hardest to analyse.
//
//   reachable     a path exists from an entry point. The path is attached.
//   unknown       no path found, but something calls this function — or the
//                 repo routes through a mechanism no reader covers. Measured
//                 case: VAmPI's real SQL injection, invisible only because its
//                 routes live in a connexion YAML spec. Suppressing that would
//                 have hidden the finding the tool exists to surface.
//   unreachable   nothing in the repo calls it and no route declares it. This
//                 is the only state that has earned suppression.
//   module-scope  runs at import, so it is not reachable FROM a route — but it
//                 definitely executes. Neither reachable nor dead; saying
//                 either would be false.
//
// Absence of evidence is not evidence of safety. `unknown` is the default and
// the honest answer, and it is ranked below `reachable` rather than hidden.
// ─────────────────────────────────────────────────────────────────────────────
//
// REACH, NOT SEQUENCE — the same discipline flowTrace holds. A path says the
// sink is reachable from the entry point. It does not say the call happens, in
// that order, on every request, or under any particular condition: there is no
// control-flow graph anywhere in this pipeline, so branches and guards are
// invisible. "Reachable from" is supportable. "Triggered by" is not.

import type { CodeGraph, SinkGraphEntry, SinkSeverity } from "../codeAnalysis/types";
import {
  buildFlowIndex,
  findDeclaredEntryPoints,
  findFlowEntryPoints,
  flowNodeId,
  splitFlowNodeId,
  type FlowGraphIndex,
} from "../codeAnalysis/flowTrace";
import { isTestFile } from "../codeAnalysis/testCoverage";
import { computeInterproceduralTaint } from "./interproceduralTaint";
import { cmpStr } from "../deterministicSort";

export type Reachability = "reachable" | "unknown" | "unreachable" | "module-scope";

/** One step in a path. */
export interface PathHop {
  filePath: string;
  name: string;
}

/** How the outside world gets in, plus the route it arrives on when a plugin
 *  declared one. `declared` is the difference between evidence and a guess:
 *  false means the entry point came from the name/path heuristic. */
export interface PathEntry extends PathHop {
  declared: boolean;
  route?: string;
  methods?: string[];
  via?: string;
}

export interface ReachabilityPath {
  entry: PathEntry;
  /** Entry first, the sink's enclosing function last. Length 1 means the sink
   *  sits in the entry point itself. */
  hops: PathHop[];
}

export interface ClassifiedSink extends SinkGraphEntry {
  reachability: Reachability;
  /** Present only when reachable. ONE path, not the only one — a shortest path
   *  from some entry point, which is enough to establish reachability. */
  path?: ReachabilityPath;
}

export interface ReachabilityReport {
  findings: ClassifiedSink[];
  counts: Record<Reachability, number>;
  /** Sinks considered, after dropping test files. */
  total: number;
  /** Findings where untrusted input was shown to reach the call. Never a
   *  filter — a sink without taint is unproven, not clean. */
  tainted: number;
  /** Entry points the walk started from. Zero means every finding lands in
   *  `unknown`, which is a statement about our readers, not about the code. */
  entryPoints: number;
}

const REACHABILITY_RANK: Record<Reachability, number> = {
  reachable: 3,
  unknown: 2,
  "module-scope": 1,
  unreachable: 0,
};
const SEVERITY_RANK: Record<SinkSeverity, number> = { high: 3, medium: 2, low: 1 };

/** Multi-source BFS from every entry point, keeping parent pointers so a path
 *  can be reconstructed for any node we touch. One traversal for all sinks. */
function walkFromEntries(
  idx: FlowGraphIndex,
  seeds: string[]
): { parent: Map<string, string | null>; origin: Map<string, string> } {
  const parent = new Map<string, string | null>();
  const origin = new Map<string, string>();
  const queue: string[] = [];
  for (const seed of seeds) {
    if (parent.has(seed)) continue;
    parent.set(seed, null);
    origin.set(seed, seed);
    queue.push(seed);
  }
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    for (const next of idx.adjacency.get(current) ?? []) {
      if (parent.has(next)) continue;
      parent.set(next, current);
      origin.set(next, origin.get(current)!);
      queue.push(next);
    }
  }
  return { parent, origin };
}

function buildPath(
  nodeId: string,
  parent: Map<string, string | null>,
  entryId: string,
  entryMeta: Map<string, PathEntry>
): ReachabilityPath {
  const hops: PathHop[] = [];
  let cursor: string | null | undefined = nodeId;
  while (cursor) {
    const [filePath, name] = splitFlowNodeId(cursor);
    hops.push({ filePath, name });
    cursor = parent.get(cursor) ?? null;
  }
  hops.reverse();
  const [entryFile, entryName] = splitFlowNodeId(entryId);
  return {
    entry: entryMeta.get(entryId) ?? { filePath: entryFile, name: entryName, declared: false },
    hops,
  };
}

/** Classify every sink in the graph.
 *
 *  Pure: a CodeGraph in, findings out. No database, no network, no filesystem —
 *  the property that keeps a local/desktop build possible. */
/** Files that exist to SET UP or EXERCISE the application, never to serve a
 *  request: seed scripts, fixtures, factories, Django management commands.
 *
 *  This is a reachability judgement, not a pattern one, which is why it lives
 *  here and not in a rule. `DEMO_PASSWORD = "Demo!Password123"` in a seeding
 *  command is fixture data an operator runs from a shell; it is not a
 *  credential an attacker can reach. Measured on 39 realistic business
 *  applications, this shape alone was 57% of all false positives (§4w) — a
 *  category the deliberately-vulnerable teaching apps in the tuning corpus do
 *  not contain at all, because they have no tests and no seed data.
 *
 *  `isTestFile` already covers `/tests/` directories and `*_test.py`; this
 *  covers what it misses. */
export function isNonProductionPath(filePath: string): boolean {
  if (!filePath) return false;
  const p = `/${filePath.toLowerCase()}/`;
  if (p.includes("/management/commands/")) return true; // Django: operator-run
  if (p.includes("/migrations/")) return true;
  if (p.includes("/factories/") || p.includes("/fixtures/")) return true;
  const base = filePath.slice(filePath.lastIndexOf("/") + 1).toLowerCase();
  return (
    base === "tests.py" ||
    base === "conftest.py" ||
    base === "factories.py" ||
    base === "fixtures.py" ||
    /^seed([_-].*)?\.py$/.test(base) ||
    /^(create_db|check_flows|populate[_a-z]*)\.py$/.test(base)
  );
}

export function classifySinks(cg: CodeGraph): ReachabilityReport {
  // Slice 6 runs first: a sink the plugin could only tie to a parameter may
  // turn out to be fed untrusted input by a caller two functions away.
  const crossFunction = computeInterproceduralTaint(cg);
  const sinks = (cg.sinks ?? [])
    .filter((s) => !isTestFile(s.filePath) && !isNonProductionPath(s.filePath))
    .map((s) => {
      if (s.taint) return s;
      const ev = crossFunction.get(`${s.filePath}\u001F${s.line}\u001F${s.ruleId}`);
      return ev ? { ...s, taint: ev } : s;
    })
    // Rules flagged requiresTaint are only findings WITH confirmed taint. This
    // runs after the interprocedural pass, so a parameter later shown to be fed
    // request data survives — but a utility helper nobody feeds does not.
    .filter((s) => !s.requiresTaint || s.taint);

  const idx = buildFlowIndex(cg);
  const declared = findDeclaredEntryPoints(cg, idx);
  const heuristic = findFlowEntryPoints(cg, { limit: 10_000 }, idx).filter(
    (e) => e.kind === "route-like"
  );

  // Declared beats heuristic on the same node: a plugin that read a route
  // decorator knows the method and path, which a filename guess never will.
  const entryMeta = new Map<string, PathEntry>();
  for (const e of [...heuristic, ...declared]) {
    const [filePath, name] = splitFlowNodeId(e.id);
    entryMeta.set(e.id, {
      filePath,
      name,
      declared: !!e.declared,
      ...(e.declared?.route !== undefined ? { route: e.declared.route } : {}),
      ...(e.declared?.methods ? { methods: e.declared.methods } : {}),
      ...(e.declared?.via ? { via: e.declared.via } : {}),
    });
  }

  const { parent, origin } = walkFromEntries(idx, [...entryMeta.keys()]);

  const findings: ClassifiedSink[] = sinks.map((sink) => {
    // A template sink has no function and no call edge. We found an
    // escape-disabled interpolation but cannot prove which view renders it, so
    // it is `unknown` — surfaced, never suppressed, and never mislabelled as
    // module-scope (which means "runs at import").
    if (sink.origin === "template") {
      return { ...sink, reachability: "unknown" as const };
    }
    if (!sink.inFunction) {
      return { ...sink, reachability: "module-scope" as const };
    }
    const id = flowNodeId(sink.filePath, sink.inFunction);
    if (parent.has(id)) {
      return {
        ...sink,
        reachability: "reachable" as const,
        path: buildPath(id, parent, origin.get(id)!, entryMeta),
      };
    }
    // Not reached. `unreachable` is the one state that has earned suppression,
    // so it takes the most evidence:
    //   - we indexed the function (never saw it ⇒ unknown, not dead)
    //   - nothing in the repo calls it
    //   - the repo has entry points AT ALL. With none, our readers didn't
    //     understand this framework, and a zero-caller function is exactly what
    //     an unread route handler looks like — VAmPI's shape. Calling that dead
    //     is the mistake the four states exist to prevent.
    const known = idx.complexity.has(id);
    const calledByAnything = (idx.inDegree.get(id) ?? 0) > 0;
    if (entryMeta.size > 0 && known && !calledByAnything) {
      return { ...sink, reachability: "unreachable" as const };
    }
    return { ...sink, reachability: "unknown" as const };
  });

  // Most actionable first: proven reach, then PROVEN UNTRUSTED INPUT, then
  // severity, then a stable tiebreak.
  //
  // Taint outranks severity deliberately. "Untrusted input reaches this call"
  // is demonstrated fact about this codebase; severity is a property of the
  // operation's class. A tainted medium is a described vulnerability; an
  // untainted high is a dangerous call we cannot show anyone can feed.
  findings.sort(
    (a, b) =>
      REACHABILITY_RANK[b.reachability] - REACHABILITY_RANK[a.reachability] ||
      Number(!!b.taint) - Number(!!a.taint) ||
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      cmpStr(a.filePath, b.filePath) ||
      a.line - b.line ||
      cmpStr(a.ruleId, b.ruleId)
  );

  const counts: Record<Reachability, number> = {
    reachable: 0,
    unknown: 0,
    unreachable: 0,
    "module-scope": 0,
  };
  for (const f of findings) counts[f.reachability]++;

  return {
    findings,
    counts,
    total: findings.length,
    tainted: findings.filter((f) => f.taint).length,
    entryPoints: entryMeta.size,
  };
}

/** Human labels for the rule ids. Kept here rather than in the component so
 *  there is one source of truth and the wording is testable — these strings are
 *  the tool's claim about what it found, and they say what the CODE does, never
 *  what an attacker could do with it. */
export const SINK_RULE_LABELS: Record<string, string> = {
  "py-os-command": "Shell command execution",
  "py-subprocess-shell": "Subprocess with shell=True",
  "py-eval": "eval() of a runtime value",
  "py-exec": "exec() of a runtime value",
  "py-pickle-load": "Pickle deserialisation",
  "py-yaml-unsafe-load": "YAML loaded without a safe loader",
  "py-sql-assembled": "SQL query built by string assembly",
  "js-dom-xss": "DOM XSS — attacker-controlled value parsed as HTML",
  "js-eval": "eval() of an attacker-controlled value",
  "py-template-safe-columns": "Template renders named columns unescaped",
  "py-credential-compared-to-literal": "Credential checked against a hardcoded value",
  "py-broken-hash-credential": "Credential or token built with a broken hash",
  "py-redos": "Regex can backtrack catastrophically (ReDoS)",
  "py-debug-enabled": "Debug mode enabled",
  "py-wildcard-allowed-hosts": "Any Host header accepted (ALLOWED_HOSTS = ['*'])",
  "py-autoescape-disabled": "Template auto-escaping disabled in config",
  "py-path-traversal": "File path built from untrusted input",
  "py-ssrf": "Outbound request to a URL built from untrusted input",
  "py-hardcoded-secret": "Credential committed as a literal",
  "py-reflected-xss": "HTML response built from untrusted input (reflected XSS)",
  "py-template-safe-filter": "Template output escaping disabled (| safe)",
  "py-template-autoescape-off": "Template auto-escaping turned off",
  "py-cors-origin-reflected": "CORS origin reflected from the request",
  "py-xxe": "XML parsed with external entities enabled",
  "py-open-redirect": "Redirect destination comes from the request",
  "py-ssti": "Template built and rendered at runtime",
  "py-mark-safe": "Output escaping switched off",
  "py-jwt-unverified": "JWT decoded without verifying its signature",
  "py-debug-server": "Debug server enabled",
  "py-tls-verify-disabled": "TLS certificate verification disabled",
};

/** What each reachability state is allowed to say out loud. "Reachable from an
 *  entry point" is supportable; "exploitable" is not, and will not be until
 *  taint analysis exists. */
export const REACHABILITY_LABELS: Record<Reachability, string> = {
  reachable: "reachable from an entry point",
  unknown: "no path found",
  unreachable: "nothing calls it",
  "module-scope": "runs at import",
};

export const sinkRuleLabel = (ruleId: string): string =>
  SINK_RULE_LABELS[ruleId] ?? ruleId;

/** Render a path as "POST /login → login() → authenticate() → execute()".
 *  Arrows read as REACHES, never as "and then" — see the module header. */
export function formatPath(path: ReachabilityPath): string {
  const start =
    path.entry.route !== undefined
      ? `${path.entry.methods?.join("/") ?? "ANY"} ${path.entry.route}`
      : path.entry.name;
  return [start, ...path.hops.map((h) => `${h.name}()`)].join(" → ");
}
