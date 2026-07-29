// Interprocedural taint (v0.82+, slice 6).
//
// Slice 5 could only see inside one function, and measured the cost of that
// honestly: 8 of pygoat's 11 findings tainted, 0 of 40 across four real
// applications. A lab writes `request.POST.get()` and the sink in one place.
// Real code writes a view, a service and a repository, and the value crosses
// two function boundaries on the way down.
//
// This closes that gap with a summary-based fixpoint over the SAME resolved
// call graph reachability walks:
//
//   the plugin says      "this call passes request.POST['cmd'] as argument 0"
//   the plugin says      "this sink consumes my parameter `cmd`"
//   this pass says       "...and argument 0 of that call IS that parameter"
//
// Neither half is a finding alone. A parameter is not untrusted because it is a
// parameter — it is untrusted when somebody fills it with user input, and only
// the graph knows whether anybody does.
//
// WHY IT LIVES HERE AND NOT IN THE PLUGIN. A URLconf- or CBV-declared handler
// gets its entryPoint stamped during buildCodeGraph, cross-file, after parsing
// is done. A plugin physically cannot know it is looking at a route handler.
// The same layering that forced routing to be resolved at graph level forces
// taint here too.
//
// DISCIPLINE, unchanged from every other pass: only RESOLVED call edges are
// followed, ambiguity declines rather than guesses, and a sink without taint is
// unproven — never clean.

import type { CodeGraph, SinkGraphEntry, TaintEvidence } from "../codeAnalysis/types";
import { flowNodeId, splitFlowNodeId } from "../codeAnalysis/flowTrace";
import { isTestFile } from "../codeAnalysis/testCoverage";

/** How many function boundaries a value may cross. Past this the path stops
 *  being something a human will read, and each extra hop multiplies the chance
 *  that one mis-resolved edge invented the whole flow. */
const MAX_TAINT_HOPS = 6;

/** Stable identity for a finding across the two passes. */
const sinkKey = (s: { filePath: string; line: number; ruleId: string }) =>
  `${s.filePath}${s.line}${s.ruleId}`;

interface Pending {
  fnId: string;
  param: string;
  ev: TaintEvidence;
}

/**
 * Follow untrusted values across function boundaries and return the taint
 * evidence for every sink that turns out to consume one.
 *
 * Pure: a CodeGraph in, a map out. Nothing is mutated.
 */
export function computeInterproceduralTaint(
  cg: CodeGraph
): Map<string, TaintEvidence> {
  const proven = new Map<string, TaintEvidence>();
  const sinks = (cg.sinks ?? []).filter((s) => !isTestFile(s.filePath));
  if (sinks.length === 0) return proven;

  // Sinks waiting on a parameter, grouped by the function that owns them.
  const awaitingParam = new Map<string, SinkGraphEntry[]>();
  for (const s of sinks) {
    if (!s.taintedByParam || !s.inFunction || s.taint) continue;
    const id = flowNodeId(s.filePath, s.inFunction);
    const arr = awaitingParam.get(id) ?? [];
    arr.push(s);
    awaitingParam.set(id, arr);
  }
  if (awaitingParam.size === 0) return proven;

  // Parameter names per function, so an argument POSITION becomes a NAME.
  const paramsOf = new Map<string, string[]>();
  for (const fn of cg.functions) {
    if (fn.params?.length) paramsOf.set(flowNodeId(fn.filePath, fn.name), fn.params);
  }

  // Resolved call edges that carry something, indexed by the CALLER so
  // propagation is a lookup rather than a scan.
  const outgoing = new Map<string, typeof cg.calls>();
  for (const c of cg.calls) {
    if (!c.toFile || !c.toFunction || !c.fromFunction) continue;
    if (!c.taintedArgs?.length) continue;
    if (isTestFile(c.fromFile)) continue;
    const from = flowNodeId(c.fromFile, c.fromFunction);
    const arr = outgoing.get(from) ?? [];
    arr.push(c);
    outgoing.set(from, arr);
  }

  /** Which parameter of the callee does this argument land on? */
  const targetParam = (
    calleeId: string,
    arg: { index: number; name?: string }
  ): string | null => {
    const params = paramsOf.get(calleeId);
    if (!params) return null;
    if (arg.name) return params.includes(arg.name) ? arg.name : null;
    return params[arg.index] ?? null;
  };

  const hopOf = (id: string) => {
    const [filePath, name] = splitFlowNodeId(id);
    return { filePath, name };
  };

  const queue: Pending[] = [];

  // Seed 1: a declared route handler's own parameters ARE request data.
  //
  // This is the half slice 5 could not reach. A plugin sees `def search(request,
  // q)` and has no idea it is a route handler, because the URLconf that says so
  // lives in another file and is resolved here. At graph level the entryPoint
  // stamp is already on the function, so the parameters can finally be seeded —
  // which is the whole argument for taint living at this layer.
  for (const fn of cg.functions) {
    if (!fn.entryPoint || !fn.params?.length) continue;
    if (isTestFile(fn.filePath)) continue;
    const id = flowNodeId(fn.filePath, fn.name);
    for (const param of fn.params) {
      if (param === "request") continue; // the framework's object, not input
      queue.push({
        fnId: id,
        param,
        ev: {
          source: `${fn.entryPoint.route ?? fn.name} (${param})`,
          line: fn.startRow + 1,
          via: param,
          hops: [hopOf(id)],
        },
      });
    }
  }

  // Seed 2: every call handing a genuinely untrusted value to a resolved callee.
  for (const c of cg.calls) {
    if (!c.toFile || !c.toFunction || !c.fromFunction) continue;
    if (isTestFile(c.fromFile)) continue;
    const calleeId = flowNodeId(c.toFile, c.toFunction);
    for (const arg of c.taintedArgs ?? []) {
      if (!arg.source) continue; // parameter-derived args propagate, not seed
      const param = targetParam(calleeId, arg);
      if (!param) continue;
      queue.push({
        fnId: calleeId,
        param,
        ev: {
          source: arg.source,
          line: arg.line,
          via: param,
          hops: [hopOf(flowNodeId(c.fromFile, c.fromFunction)), hopOf(calleeId)],
        },
      });
    }
  }

  // Fixpoint. Visited on (function, parameter) — reaching the same parameter by
  // a second route adds no information and would otherwise cycle forever.
  const seen = new Set<string>();
  while (queue.length > 0) {
    const { fnId, param, ev } = queue.shift()!;
    const key = `${fnId}${param}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Does anything dangerous in this function consume that parameter?
    for (const s of awaitingParam.get(fnId) ?? []) {
      if (s.taintedByParam !== param) continue;
      const existing = proven.get(sinkKey(s));
      // Shortest itinerary wins — the least indirection a reader has to follow.
      if (!existing || (ev.hops?.length ?? 0) < (existing.hops?.length ?? 0)) {
        proven.set(sinkKey(s), ev);
      }
    }

    if ((ev.hops?.length ?? 0) >= MAX_TAINT_HOPS) continue;

    // Hand it on: any call from here that passes this parameter along.
    for (const c of outgoing.get(fnId) ?? []) {
      const calleeId = flowNodeId(c.toFile!, c.toFunction!);
      for (const arg of c.taintedArgs ?? []) {
        if (arg.param !== param) continue;
        const next = targetParam(calleeId, arg);
        if (!next) continue;
        queue.push({
          fnId: calleeId,
          param: next,
          ev: { ...ev, via: next, hops: [...(ev.hops ?? []), hopOf(calleeId)] },
        });
      }
    }
  }

  return proven;
}

/** Render a flow as "request.POST['cmd'] → view() → service() → run()". */
export function formatTaintFlow(ev: TaintEvidence): string {
  const chain = (ev.hops ?? []).map((h) => `${h.name}()`);
  return [ev.source, ...chain].join(" → ");
}
