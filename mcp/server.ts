#!/usr/bin/env node
// GitVision MCP server (v0.64 / C1.1).
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
// The server runs as a child process of the MCP client. State is
// in-memory only in C1.1 — sessions live for 10 minutes after the
// last analyze_repo call. C1.2 will add an on-disk cache layer at
// ~/.gitvision/cache so sessions survive restarts.
//
// C1.1 ships two tools (analyze_repo + blast_radius). C1.2 adds three
// more (find_duplicates, untested_hotspots, signals). Each tool is
// implemented in mcp/tools/<name>.ts; this file is just the wiring.

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

const SERVER_VERSION = "0.64.0";

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
