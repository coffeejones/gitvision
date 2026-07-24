#!/usr/bin/env node
// Pack-and-test the codetrawl-mcp package — the verification that matters.
//
// A green unit suite proves nothing here: the WASM-resolution break is silent
// until the FIRST parse in an installed context. So we npm-pack the package,
// install the tarball into a clean temp dir (as an agent would), spawn the
// installed binary as an MCP stdio server with its cwd pointed at an EMPTY
// project dir (no node_modules — so cwd-based resolution can only fail and the
// require.resolve path is the one under test), then actually call analyze_repo
// so tree-sitter WASM parses. tools/list + a real parse = the package works.
//
//   npm run mcp:pack:test              # default tiny repo
//   REPO=https://github.com/owner/x npm run mcp:pack:test
//   GITHUB_TOKEN=… npm run mcp:pack:test   # lift the 60/hr fetch limit

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const PKG = path.join(ROOT, "mcp", "pkg");
const REPO = process.env.REPO ?? "https://github.com/jonschlinkert/is-number";

const log = (s) => console.log(s);
const fail = (s) => {
  console.error("\n  ✗ " + s + "\n");
  process.exit(1);
};

let tmp;
try {
  log("\n  building the package…");
  execFileSync("node", ["scripts/build-mcp-package.mjs"], { cwd: ROOT, stdio: "inherit" });

  log("  npm pack…");
  const packJson = execFileSync("npm", ["pack", "--json"], { cwd: PKG, encoding: "utf8" });
  const tarball = path.join(PKG, JSON.parse(packJson)[0].filename);

  // Install into a clean temp dir — the "someone ran npm i codetrawl-mcp" world.
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctmcp-"));
  fs.writeFileSync(
    path.join(tmp, "package.json"),
    JSON.stringify({ name: "ctmcp-test", private: true }) + "\n",
  );
  log(`  installing tarball → ${tmp}`);
  execFileSync("npm", ["install", "--no-audit", "--no-fund", tarball], { cwd: tmp, stdio: "inherit" });
  const bin = path.join(tmp, "node_modules", ".bin", "codetrawl-mcp");
  if (!fs.existsSync(bin)) fail(`bin symlink missing at ${bin}`);

  // Run with cwd = an EMPTY dir (no node_modules) so cwd resolution CANNOT work.
  const agentCwd = path.join(tmp, "agent-project");
  fs.mkdirSync(agentCwd);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bin],
    cwd: agentCwd,
    env: { ...process.env },
  });
  const client = new Client({ name: "pack-test", version: "0" });
  await client.connect(transport);

  const { tools } = await client.listTools();
  log(`  tools/list → ${tools.length}: ${tools.map((t) => t.name).join(", ")}`);
  if (tools.length < 9) fail(`expected >= 9 tools, got ${tools.length}`);

  log(`  analyze_repo ${REPO}  (fetch + tree-sitter parse in the installed context)…`);
  const res = await client.callTool({ name: "analyze_repo", arguments: { repoUrl: REPO } });
  const text = (res.content ?? []).map((c) => c.text ?? "").join("\n");
  if (res.isError) fail(`analyze_repo errored — likely the WASM path:\n    ${text.slice(0, 500)}`);
  if (!/session/i.test(text)) fail(`analyze_repo returned no session:\n    ${text.slice(0, 500)}`);
  log("  ✓ analyze_repo parsed standalone — WASM resolves from the package, not cwd");

  await client.close();
  fs.rmSync(tarball, { force: true });
  log("\n  ✓ codetrawl-mcp packs, installs, boots, lists 9 tools, and PARSES standalone.\n");
} finally {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
}
