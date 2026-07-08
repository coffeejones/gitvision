// CI-hardening entry point (Arc 4). Reads .github/workflows/*.{yml,yaml} from
// the extracted repo and runs the pure detectors (analyze.ts). Server-only —
// the fs read lives here so analyze.ts stays unit-testable over file contents.

import { promises as fs } from "node:fs";
import path from "node:path";
import { analyzeWorkflows } from "./analyze";
import type { CIHardeningReport } from "./types";

/** Bounds so a pathological repo can't blow up the analysis. */
const MAX_WORKFLOWS = 60;
const MAX_BYTES = 512 * 1024; // 512 KB per workflow file

/** Read + assess a repo's GitHub Actions workflows. Returns undefined when the
 *  repo has no .github/workflows directory (or nothing parseable in it). */
export async function computeCiHardening(
  extractDir: string,
  repoOwner: string,
): Promise<CIHardeningReport | undefined> {
  const wfDir = path.join(extractDir, ".github", "workflows");

  let entries;
  try {
    entries = await fs.readdir(wfDir, { withFileTypes: true });
  } catch {
    return undefined; // no workflows directory
  }

  const files: { path: string; content: string }[] = [];
  for (const e of entries) {
    if (files.length >= MAX_WORKFLOWS) break;
    if (!e.isFile() || !/\.ya?ml$/i.test(e.name)) continue;
    try {
      const full = path.join(wfDir, e.name);
      const stat = await fs.stat(full);
      if (stat.size > MAX_BYTES) continue;
      const content = await fs.readFile(full, "utf-8");
      files.push({ path: `.github/workflows/${e.name}`, content });
    } catch {
      /* skip unreadable file */
    }
  }

  return analyzeWorkflows(files, repoOwner);
}
