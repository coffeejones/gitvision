#!/usr/bin/env node
// Flow probe — Option A's compute, no UI. Answers the one question that should
// gate the spend: are the traces legible stories, or two boxes?
//
// Runs over the snapshots already on disk (.gitvision/sessions/*.json) — no
// GitHub fetch, no re-parse, no API cost. Builds the resolved fn→fn call graph,
// picks entry-point candidates from heuristics that already exist in the product
// (orchestrator = calls ≥3 of the repo's own functions; zero-caller = nothing
// calls it), reconstructs parent-pointer paths, and renders the trees.
//
//   npm run flow-probe                 # verdict table + sample traces, all repos
//   npm run flow-probe -- gin          # only repos matching 'gin'
//   npm run flow-probe -- gitvision 12 # ...and show 12 sample traces
//
// HONESTY NOTE — this prints REACH, not sequence. Children are sorted by name,
// deliberately: the graph's own call order is AST pre-order, which visits a call
// BEFORE the calls that are its own arguments, so it inverts execution order for
// nested calls. There is no CFG in the codebase, so branches, loops and early
// returns are invisible. "X reaches Y" is supportable; "X then Y" is not.

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SESSIONS = path.join(ROOT, ".gitvision", "sessions");
const [repoFilter, sampleArg] = process.argv.slice(2);
const SAMPLES = Number(sampleArg) || 6;

// A trace is a "legible story" when it goes at least this deep and wide —
// i.e. it shows a hand-off through layers, not a single call.
const STORY_MIN_DEPTH = 3;
const STORY_MIN_NODES = 5;
const MAX_DEPTH = 8;
const MAX_NODES = 200;

const SEP = "\u001E";
const key = (file, fn) => `${file}${SEP}${fn}`;
const unkey = (k) => k.split(SEP);
const short = (f) => (f.length > 44 ? "…" + f.slice(-43) : f);

function loadSnapshots() {
  if (!fs.existsSync(SESSIONS)) return [];
  const out = [];
  for (const f of fs.readdirSync(SESSIONS).filter((n) => n.endsWith(".json"))) {
    let d;
    try {
      d = JSON.parse(fs.readFileSync(path.join(SESSIONS, f), "utf8"));
    } catch {
      continue;
    }
    // Newest snapshot with a call graph wins.
    const snaps = (d.snapshots ?? []).filter((s) => s?.codeGraph?.calls?.length);
    if (!snaps.length) continue;
    const snap = snaps[snaps.length - 1];
    const repo =
      snap.repoFullName ?? String(d.repoUrl ?? "").split("github.com/").pop() ?? d.id;
    out.push({ repo, cg: snap.codeGraph });
  }
  return out;
}

/** Resolved function→function adjacency + reverse index. Unresolved edges
 *  (toFile null) and module-scope callers are dropped — they can't carry a flow. */
function buildGraph(cg) {
  const adj = new Map();
  const indeg = new Map();
  const nodes = new Set();
  let resolved = 0;
  for (const c of cg.calls ?? []) {
    if (!c.fromFunction || !c.toFile || !c.toFunction) continue;
    resolved++;
    const a = key(c.fromFile, c.fromFunction);
    const b = key(c.toFile, c.toFunction);
    if (a === b) continue; // self-recursion adds no story
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a).add(b);
    indeg.set(b, (indeg.get(b) ?? 0) + 1);
    nodes.add(a);
    nodes.add(b);
  }
  return { adj, indeg, nodes, resolved, total: (cg.calls ?? []).length };
}

/** Does this look like a REAL entry point — the thing a user or the outside
 *  world actually triggers? Path/name shaped, deliberately crude: the point of
 *  the probe is to measure whether a proper entry-point detector would be worth
 *  building, by seeing how much better these traces are than generic ones. */
const ROUTE_FILE = /(^|\/)(route|handler|controller|endpoint|main|cmd|server|app|index)\.[a-z]+$|\/(routes?|controllers?|handlers?|api|cmd|pages)\//i;
const ROUTE_FN = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$|^(handle|serve|on|route|main|run|process)[A-Z_]|Handler$|Controller$|^main$/;
function looksLikeEntryPoint(file, fn) {
  return ROUTE_FILE.test(file) || ROUTE_FN.test(fn);
}

/** Entry-point candidates, from heuristics the product already uses. No new
 *  analysis: orchestrators (fan-out ≥3) and zero-caller functions. */
function entryCandidates(g) {
  const out = [];
  for (const n of g.nodes) {
    const fanOut = g.adj.get(n)?.size ?? 0;
    const fanIn = g.indeg.get(n) ?? 0;
    if (fanOut === 0) continue;
    const isOrchestrator = fanOut >= 3;
    const isRoot = fanIn === 0;
    if (isOrchestrator || isRoot) {
      const [file, fn] = unkey(n);
      out.push({
        node: n,
        fanOut,
        fanIn,
        kind: isRoot ? "root" : "orchestrator",
        routeLike: looksLikeEntryPoint(file, fn),
      });
    }
  }
  return out;
}

/** BFS with parent pointers → the reach tree from one entry. */
function trace(g, start) {
  const parent = new Map([[start, null]]);
  const depth = new Map([[start, 0]]);
  const order = [start];
  const q = [start];
  let truncated = false;
  while (q.length) {
    const n = q.shift();
    const d = depth.get(n);
    if (d >= MAX_DEPTH) continue;
    // Sort by NAME, not graph order — graph order is AST pre-order, not execution order.
    const kids = [...(g.adj.get(n) ?? [])].sort();
    for (const m of kids) {
      if (parent.has(m)) continue;
      if (order.length >= MAX_NODES) {
        truncated = true;
        break;
      }
      parent.set(m, n);
      depth.set(m, d + 1);
      order.push(m);
      q.push(m);
    }
  }
  const maxDepth = Math.max(...depth.values());
  return { parent, depth, order, maxDepth, nodes: order.length, truncated };
}

function renderTree(t, root) {
  const children = new Map();
  for (const [n, p] of t.parent) {
    if (p == null) continue;
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(n);
  }
  const lines = [];
  const walk = (n, prefix, isLast, isRoot) => {
    const [file, fn] = unkey(n);
    const branch = isRoot ? "" : isLast ? "└─ " : "├─ ";
    lines.push(`${prefix}${branch}${fn}  ${dim(short(file))}`);
    const kids = (children.get(n) ?? []).sort();
    kids.forEach((k, i) =>
      walk(k, prefix + (isRoot ? "" : isLast ? "   " : "│  "), i === kids.length - 1, false)
    );
  };
  walk(root, "", true, true);
  return lines;
}

const dim = (s) => `\u001b[2m${s}\u001b[0m`;
const bold = (s) => `\u001b[1m${s}\u001b[0m`;

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function main() {
  let snaps = loadSnapshots();
  if (repoFilter) snaps = snaps.filter((s) => s.repo.toLowerCase().includes(repoFilter.toLowerCase()));
  if (!snaps.length) {
    console.error(`\n  No snapshots with call graphs found in ${SESSIONS}${repoFilter ? ` matching '${repoFilter}'` : ""}.\n`);
    process.exit(1);
  }

  const rows = [];
  const allStories = [];

  for (const { repo, cg } of snaps) {
    const g = buildGraph(cg);
    if (!g.nodes.size) continue;
    const entries = entryCandidates(g);
    const traces = entries.map((e) => ({ ...e, ...trace(g, e.node) }));
    const stories = traces.filter((t) => t.maxDepth >= STORY_MIN_DEPTH && t.nodes >= STORY_MIN_NODES);
    rows.push({
      repo,
      resolvedPct: g.total ? Math.round((g.resolved / g.total) * 100) : 0,
      entries: entries.length,
      medDepth: median(traces.map((t) => t.maxDepth)),
      medNodes: median(traces.map((t) => t.nodes)),
      stories: stories.length,
      storyPct: traces.length ? Math.round((stories.length / traces.length) * 100) : 0,
      best: stories.sort((a, b) => b.nodes - a.nodes || b.maxDepth - a.maxDepth)[0],
    });
    for (const s of stories) allStories.push({ repo, ...s });
  }

  // ---- verdict table ----
  console.log(`\n  ${bold("FLOW PROBE")} — reach traces from ${snaps.length} local snapshot(s). No API cost.\n`);
  const pad = (s, n) => String(s).padEnd(n);
  const rpad = (s, n) => String(s).padStart(n);
  console.log(
    `  ${pad("repo", 32)}${rpad("res%", 5)}${rpad("entries", 8)}${rpad("medDep", 7)}${rpad("medNod", 7)}${rpad("stories", 8)}${rpad("story%", 7)}`
  );
  console.log("  " + "─".repeat(74));
  for (const r of rows.sort((a, b) => b.stories - a.stories)) {
    console.log(
      `  ${pad(r.repo.slice(0, 31), 32)}${rpad(r.resolvedPct, 5)}${rpad(r.entries, 8)}${rpad(r.medDepth, 7)}${rpad(r.medNodes, 7)}${rpad(r.stories, 8)}${rpad(r.storyPct + "%", 7)}`
    );
  }

  const totEntries = rows.reduce((n, r) => n + r.entries, 0);
  const totStories = rows.reduce((n, r) => n + r.stories, 0);
  console.log("  " + "─".repeat(74));
  console.log(
    `  ${pad("TOTAL", 32)}${rpad("", 5)}${rpad(totEntries, 8)}${rpad(median(rows.map((r) => r.medDepth)), 7)}${rpad(median(rows.map((r) => r.medNodes)), 7)}${rpad(totStories, 8)}${rpad(totEntries ? Math.round((totStories / totEntries) * 100) + "%" : "—", 7)}`
  );
  console.log(
    `\n  ${dim(`"story" = reach tree at least ${STORY_MIN_DEPTH} deep and ${STORY_MIN_NODES} nodes wide — i.e. a hand-off through layers, not a single call.`)}`
  );
  console.log(`  ${dim("res% = share of call edges that resolve to a known function (unresolved edges carry no flow).")}\n`);

  // ---- sample traces ----
  console.log(`  ${bold(`SAMPLE TRACES`)} — the ${SAMPLES} biggest, one per repo first\n`);
  const seen = new Set();
  const picks = [];
  for (const r of rows) if (r.best && !seen.has(r.repo)) { picks.push({ repo: r.repo, ...r.best }); seen.add(r.repo); }
  for (const s of allStories.sort((a, b) => b.nodes - a.nodes)) {
    if (picks.length >= SAMPLES) break;
    if (picks.some((p) => p.node === s.node && p.repo === s.repo)) continue;
    picks.push(s);
  }
  for (const p of picks.slice(0, SAMPLES)) {
    const [file, fn] = unkey(p.node);
    console.log(
      `  ${bold(p.repo)} · ${bold(fn)} ${dim(`(${p.kind}, fan-out ${p.fanOut})`)} — reaches ${p.nodes} fns, ${p.maxDepth} deep${p.truncated ? " (truncated)" : ""}`
    );
    console.log(`  ${dim(short(file))}`);
    for (const line of renderTree(p, p.node).slice(0, 26)) console.log("    " + line);
    if (p.nodes > 26) console.log(`    ${dim(`… ${p.nodes - 26} more`)}`);
    console.log("");
  }

  // ---- the decisive comparison: does picking a REAL entry point matter? ----
  let rl = { n: 0, stories: 0, depth: [], nodes: [] };
  let generic = { n: 0, stories: 0, depth: [], nodes: [] };
  for (const { repo, cg } of snaps) {
    const g = buildGraph(cg);
    if (!g.nodes.size) continue;
    for (const e of entryCandidates(g)) {
      const t = trace(g, e.node);
      const bucket = e.routeLike ? rl : generic;
      bucket.n++;
      bucket.depth.push(t.maxDepth);
      bucket.nodes.push(t.nodes);
      if (t.maxDepth >= STORY_MIN_DEPTH && t.nodes >= STORY_MIN_NODES) bucket.stories++;
    }
  }
  const rate = (b) => (b.n ? Math.round((b.stories / b.n) * 100) : 0);
  console.log(`  ${bold("DOES PICKING A REAL ENTRY POINT MATTER?")}`);
  console.log(`  ${pad("bucket", 24)}${rpad("n", 7)}${rpad("medDep", 8)}${rpad("medNod", 8)}${rpad("story%", 8)}`);
  console.log("  " + "─".repeat(55));
  console.log(`  ${pad("route/handler-like", 24)}${rpad(rl.n, 7)}${rpad(median(rl.depth), 8)}${rpad(median(rl.nodes), 8)}${rpad(rate(rl) + "%", 8)}`);
  console.log(`  ${pad("everything else", 24)}${rpad(generic.n, 7)}${rpad(median(generic.depth), 8)}${rpad(median(generic.nodes), 8)}${rpad(rate(generic) + "%", 8)}`);
  console.log(
    `\n  ${dim("If route-like traces are much richer, entry-point detection is what makes the feature — not depth.")}\n`
  );

  // ---- go / no-go ----
  const pct = totEntries ? Math.round((totStories / totEntries) * 100) : 0;
  console.log(`  ${bold("GO / NO-GO")}`);
  console.log(
    `  ${totStories} of ${totEntries} entry-point candidates (${pct}%) produce a trace worth drawing.`
  );
  console.log(
    `  ${dim("Judge the sample trees above: does a non-coder learn something, or is it a call list?")}`
  );
  console.log(
    `  ${dim('Remember the honest word is "reaches", not "then" — this is static reach, not execution order.')}\n`
  );
}

main();
