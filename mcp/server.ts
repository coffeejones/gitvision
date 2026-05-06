#!/usr/bin/env node
// GitVision MCP server (v0.64 / C1.1, expanded v0.65 / C1.2).
//
// Exposes the GitVision analysis pipeline as Model Context Protocol
// tools so AI coding agents (Claude Code, Cursor, Cline, etc.) can
// query deterministic structural information about a GitHub repo
// without hallucinating cross-file relationships.
//
// Transport: stdio. Standard MCP install path is:
//
//   $ npm install -g gitvision-mcp
//   $ claude mcp add gitvision npx gitvision-mcp
//
// The server runs as a child process of the MCP client. Sessions are
// cached in-memory (10-min TTL, 8 entries) AND on-disk at
// ~/.gitvision/cache/ (24h TTL) so they survive the frequent restarts
// MCP clients perform during dev sessions.
//
// Five tools as of C1.2:
//   analyze_repo        Entry point — every other tool needs sessionId
//   blast_radius        File or function-level reach
//   find_duplicates     Structurally identical functions (refactor signal)
//   untested_hotspots   Production fns with no test caller
//   signals             Full 17-signal health verdict + dimension rollup
//
// Each tool is implemented in mcp/tools/<name>.ts; this file is just
// the wiring.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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

const SERVER_VERSION = "0.65.0";

const server = new McpServer({
  name: "gitvision",
  version: SERVER_VERSION,
});

server.registerTool(
  "analyze_repo",
  {
    description:
      "Download a GitHub repo, run AST + git-history analysis, return a session id and a compact summary. Always call this first — every other GitVision tool needs the session id. Cached for 10 minutes per repo URL so subsequent calls on the same URL are free.",
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // No console.log here — stdio transport reserves stdout for MCP
  // protocol JSON-RPC. Anything else corrupts the channel. Use
  // console.error if logging is genuinely needed (stderr is free).
}

main().catch((err) => {
  // Stderr is the only safe place to log fatal errors during stdio
  // protocol operation. The MCP client will surface this in its own
  // error UI.
  console.error("gitvision-mcp fatal:", err);
  process.exit(1);
});
