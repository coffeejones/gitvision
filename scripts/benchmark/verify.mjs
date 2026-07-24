#!/usr/bin/env node
// Verify everything EXCEPT the Claude calls: the clone, the grep+read tools, and
// the codetrawl-mcp bridge (lists its tools). No ANTHROPIC_API_KEY needed. If
// this is green, the only thing gating a real run is the API key.

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { REPO } from "./tasks.mjs";
import { codetrawlProvider, fileProvider } from "./tools.mjs";
import { loadEnvLocal } from "./env.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const WORK = path.join(HERE, ".work");
loadEnvLocal(ROOT);

const dir = path.join(WORK, REPO.name.replace(/\//g, "__"));
if (!fs.existsSync(path.join(dir, ".git"))) {
  fs.mkdirSync(dir, { recursive: true });
  console.log("  cloning …");
  execFileSync("git", ["clone", "--depth", "1", REPO.url, dir], { stdio: "ignore" });
}

const fp = fileProvider(dir);
console.log("\n  fileProvider tools:", fp.tools.map((t) => t.name).join(", "));
console.log("  list_dir(lib):", (await fp.execute("list_dir", { path: "lib" })).split("\n").join(" "));
console.log("  grep(res.download in response.js):\n    " + (await fp.execute("grep", { pattern: "res\\.download = function", path: "lib/response.js" })));
console.log("  read_file(response.js 435-435):\n    " + (await fp.execute("read_file", { path: "lib/response.js", start_line: 435, end_line: 435 })));
try {
  await fp.execute("read_file", { path: "../../../etc/passwd" });
  console.log("  ✗ path escape NOT blocked");
} catch {
  console.log("  ✓ path escape blocked");
}

console.log("\n  connecting codetrawl-mcp (npx, first run downloads)…");
const ct = await codetrawlProvider({ env: { ...process.env } });
console.log(`  ✓ codetrawl-mcp: ${ct.tools.length} tools → ${ct.tools.map((t) => t.name).join(", ")}`);
await ct.close();
console.log("\n  ✓ harness verified end-to-end except the Claude calls.\n");
