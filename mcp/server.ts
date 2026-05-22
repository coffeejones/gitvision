#!/usr/bin/env node
// RepoBaron MCP server entry point (v0.64 / C1.1, expanded v0.65 / C1.2,
// refactored v0.66 / C1.3 to share a buildServer() with tests).
//
// Exposes the RepoBaron analysis pipeline as Model Context Protocol
// tools so AI coding agents (Claude Code, Cursor, Cline, etc.) can
// query deterministic structural information about a GitHub repo
// without hallucinating cross-file relationships.
//
// Transport: stdio. Standard MCP install path is:
//
//   $ npm install -g repobaron-mcp
//   $ claude mcp add repobaron npx repobaron-mcp
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
// the wiring. buildServer() lives in buildServer.ts so the test suite
// can construct an identically-configured server attached to an
// in-memory transport.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./buildServer.js";

async function main() {
  const server = buildServer();
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
  console.error("repobaron-mcp fatal:", err);
  process.exit(1);
});
