// Server-construction helper, separated from server.ts so tests can
// build a McpServer instance without going through stdio (and the
// stdio transport eats stdout, which makes test output hard to read).
//
// Production entry (mcp/server.ts) calls buildServer() and connects
// it to a StdioServerTransport. Tests can call buildServer() and
// connect it to an InMemoryTransport to round-trip JSON-RPC calls
// in-process.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  analyzeRepoInputSchema,
  handleAnalyzeRepo,
} from "./tools/analyzeRepo.js";
import {
  blastRadiusInputSchema,
  handleBlastRadius,
} from "./tools/blastRadius.js";
import {
  findDuplicatesInputSchema,
  handleFindDuplicates,
} from "./tools/findDuplicates.js";
import {
  untestedHotspotsInputSchema,
  handleUntestedHotspots,
} from "./tools/untestedHotspots.js";
import {
  signalsInputSchema,
  handleSignals,
} from "./tools/signals.js";
import {
  compareSessionsInputSchema,
  handleCompareSessions,
} from "./tools/compareSessions.js";
import {
  analyzeDiffInputSchema,
  handleAnalyzeDiff,
} from "./tools/analyzeDiff.js";
import {
  reviewChangesInputSchema,
  handleReviewChanges,
} from "./tools/reviewChanges.js";
import {
  simulateChangeInputSchema,
  handleSimulateChange,
} from "./tools/simulateChange.js";

export const SERVER_NAME = "codetrawl";
export const SERVER_VERSION = "0.67.0";

/** Build a fully-configured CodeTrawl MCP server with all tools
 *  registered. The caller decides which transport to attach (stdio
 *  in production, InMemoryTransport in tests). */
export function buildServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  server.registerTool(
    "analyze_repo",
    {
      description:
        "Download a GitHub repo, run AST + git-history analysis, return a session id and a compact summary. Always call this first — every other CodeTrawl tool needs the session id. Cached for 10 minutes per repo URL so subsequent calls on the same URL are free.",
      inputSchema: analyzeRepoInputSchema,
    },
    handleAnalyzeRepo
  );

  server.registerTool(
    "blast_radius",
    {
      description:
        "Compute what breaks if you change a file or function. Pass `file` for file-level reach (imports + call edges, capped at 3 hops). Add `fn` (and optionally `container`) for function-level reach (callers + callees). Function-level requires JS/TS, Python, Go, or Java source.",
      inputSchema: blastRadiusInputSchema,
    },
    handleBlastRadius
  );

  server.registerTool(
    "find_duplicates",
    {
      description:
        "Find structurally identical functions across the codebase via FNV-1a AST hashes. Surfaces refactor candidates: when the same function body appears in multiple files (modulo identifier renaming), there's usually a missing helper. Skip-trivial defaults filter out one-line getters and similar noise.",
      inputSchema: findDuplicatesInputSchema,
    },
    handleFindDuplicates
  );

  server.registerTool(
    "untested_hotspots",
    {
      description:
        "List production functions with no direct test caller, ranked by complexity. Computed via call-graph walk from test files into prod files — direct calls only, no transitive coverage. Returns the hotspot list plus repo-wide coverage totals so an agent can reason about both individual cases and overall test debt in one call.",
      inputSchema: untestedHotspotsInputSchema,
    },
    handleUntestedHotspots
  );

  server.registerTool(
    "signals",
    {
      description:
        "Full 17-signal health verdict — what works, what needs work, what's worth a human eye. Returns both raw signals (with severity, evidence, IDs) and a 6-dimension rollup (Activity, Team, Code, PR flow, Dependencies, Hygiene) so agents can quote specific findings or summarize at a high level. Pure rule-based, no AI involved.",
      inputSchema: signalsInputSchema,
    },
    handleSignals
  );

  server.registerTool(
    "compare_sessions",
    {
      description:
        "Diff two analyses of the same repo. Returns added/removed functions, duplicate-group net change, coverage delta, and per-file complexity shifts. Useful for verifying that a refactor moved the needle: analyze before, apply changes, analyze again, then compare. Both session ids must already be in the cache (call analyze_repo first for each).",
      inputSchema: compareSessionsInputSchema,
    },
    handleCompareSessions
  );

  server.registerTool(
    "analyze_diff",
    {
      description:
        "Function-level diff between two AnalysisSnapshots, designed for PR-comment-grade detail. Returns every changed function classified as added/removed/modified/unchanged, with per-function complexity delta and a bodyChanged flag (catches bug fixes that don't change complexity). Use this for PR review workflows where you need to enumerate each change; use compare_sessions for high-level overview (top-10 lists + dup-group + coverage delta). Both session ids must already be cached.",
      inputSchema: analyzeDiffInputSchema,
    },
    handleAnalyzeDiff
  );

  server.registerTool(
    "review_changes",
    {
      description:
        "Generate prioritized verification suggestions for a PR-style review. Companion to analyze_diff: where analyze_diff returns the raw ChangedFunction[], review_changes runs the deterministic rules engine on top and returns top-3 actionable suggestions (e.g. 'addPet complexity rose +7 without tests' or 'PR adds +29 complexity across 174 functions'). Each suggestion carries severity (critical/warning/info), human-readable text, evidence list, and impact score. Use for PR-bot output and reviewer hints; use analyze_diff when you need the raw enumeration.",
      inputSchema: reviewChangesInputSchema,
    },
    handleReviewChanges
  );

  server.registerTool(
    "simulate_change",
    {
      description:
        "Simulate a proposed diff BEFORE committing it and get a deterministic verdict on what it breaks. Pass the session id and your changed files (whole-file edits, adds, or deletes); the change is spliced into the cached parse layer and the graph is rebuilt (byte-identical to a full re-analysis for JS/TS), then diffed against the base. Returns a traffic-light verdict, the blast (load-bearing walls touched, dependents reached, guarding tests to run) and a machine-readable requiredActions list — load-bearing code changed with no guarding test, a new test that asserts nothing, code that now duplicates an existing function. Sub-second: only the changed files are re-parsed. The agent conscience — call it to check a candidate change instead of finding out after the fact.",
      inputSchema: simulateChangeInputSchema,
    },
    handleSimulateChange
  );

  return server;
}
