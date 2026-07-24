#!/usr/bin/env node
// Standalone entry for the published `codetrawl-mcp` npm package.
//
// The repo-source entry (server.ts) assumes cwd is the CodeTrawl repo. Installed
// as a package, cwd is the AGENT's project instead — so two things that default
// to cwd must be re-pointed before anything parses:
//   1. tree-sitter WASM (web-tree-sitter core + @vscode grammars) → resolved
//      from THIS package's own installed deps, not cwd.
//   2. the parse/session cache dir → the user's homedir, so simulate_change
//      never writes a .gitvision into the agent's repo (matches mcp/cache.ts).
//
// esbuild bundles this file into the shipped server, externalizing only
// web-tree-sitter (see scripts/build-mcp-package.mjs). require.resolve stays a
// runtime call against the package's node_modules. CJS-safe on purpose: no
// import.meta, so it typechecks in the CommonJS repo root and bundles clean.

import path from "node:path";
import os from "node:os";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { setWasmDirs } from "../lib/codeAnalysis/runtime.js";
import { buildServer } from "./buildServer.js";

// Cache under the user's home, never the agent's cwd.
process.env.CODETRAWL_DATA_DIR ??= path.join(os.homedir(), ".gitvision");

// Point WASM resolution at this package's own installed deps. require.resolve
// walks up from the running module, so it finds them in the package's
// node_modules no matter where the agent invoked us. Resolve ACTUAL wasm files,
// not package.json: web-tree-sitter's `exports` field blocks a bare
// package.json resolve (ERR_PACKAGE_PATH_NOT_EXPORTED), but it exports the core
// .wasm; @vscode/tree-sitter-wasm has no exports, so a grammar file resolves
// fine — and its dir IS the grammar dir.
setWasmDirs({
  wtsDir: path.dirname(require.resolve("web-tree-sitter/web-tree-sitter.wasm")),
  grammarDir: path.dirname(
    require.resolve("@vscode/tree-sitter-wasm/wasm/tree-sitter-javascript.wasm"),
  ),
});

async function main() {
  const server = buildServer();
  await server.connect(new StdioServerTransport());
  // stdout is reserved for the JSON-RPC channel; log only to stderr.
}

main().catch((err) => {
  console.error("[codetrawl-mcp] fatal:", err);
  process.exit(1);
});
