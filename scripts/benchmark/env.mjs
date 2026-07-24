// Load KEY=VALUE lines from .env.local into process.env (only keys not already
// set). Secret values are never printed — the harness reads them, the operator
// never has to paste them on a command line.
import fs from "node:fs";
import path from "node:path";

export function loadEnvLocal(root) {
  const p = path.join(root, ".env.local");
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, "utf8").split("\n")) {
    const m = raw.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}
