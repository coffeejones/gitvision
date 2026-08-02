// Emit CodeTrawl findings for each RealVuln repo in the Semgrep results.json
// format the benchmark scorer consumes. Two variants:
//   codetrawl-detect   — every sink the rules produce (detection accuracy)
//   codetrawl-surfaced — what the panel shows (drops `unreachable`)
import fs from "node:fs";
import path from "node:path";
import { ALL_PLUGINS } from "../lib/codeAnalysis/plugins/all";
import { analyzeDirectory } from "../lib/codeAnalysis/analyze";
import { classifySinks } from "../lib/security/reachability";

// One CWE per finding (the parser splits a list into separate findings, which
// would double-count). Chosen so the CWE sits in the GT class's acceptable set.
const CWE: Record<string, string> = {
  "py-sql-assembled": "CWE-89",
  "py-os-command": "CWE-78",
  "py-subprocess-shell": "CWE-78",
  "py-eval": "CWE-94",
  "py-exec": "CWE-94",
  "py-pickle-load": "CWE-502",
  "py-yaml-unsafe-load": "CWE-502",
  "py-cors-origin-reflected": "CWE-942",
  "py-credential-logged": "CWE-532",
  "py-weak-prng-secret": "CWE-330",
  "py-xxe": "CWE-611",
  "py-open-redirect": "CWE-601",
  "py-ssti": "CWE-1336",
  "py-mark-safe": "CWE-79",
  "py-jwt-unverified": "CWE-347",
  "py-tls-verify-disabled": "CWE-295",
  "py-debug-server": "CWE-489",
  "py-template-safe-filter": "CWE-79",
  "py-reflected-xss": "CWE-79",
  "py-hardcoded-secret": "CWE-798",
  "js-dom-xss": "CWE-79",
  "js-eval": "CWE-94",
  "py-template-safe-columns": "CWE-79",
  "py-credential-compared-to-literal": "CWE-798",
  "py-broken-hash-credential": "CWE-328",
  "py-redos": "CWE-1333",
  "py-debug-enabled": "CWE-489",
  "py-wildcard-allowed-hosts": "CWE-16",
  "py-autoescape-disabled": "CWE-16",
  "py-insecure-cookie-flag": "CWE-614",
  "py-path-traversal": "CWE-22",
  "py-ssrf": "CWE-918",
  "py-template-autoescape-off": "CWE-79",
};

function toResult(f: { ruleId: string; filePath: string; line: number; severity: string }) {
  const cwe = CWE[f.ruleId];
  if (!cwe) return null;
  return {
    check_id: cwe,
    path: f.filePath,
    start: { line: f.line, col: null },
    end: null,
    extra: { severity: f.severity, metadata: { cwe: [cwe], rule: f.ruleId } },
  };
}

async function main() {
  const [reposDir, outDir] = process.argv.slice(2);
  const slugs = fs.readdirSync(reposDir).filter((d) =>
    fs.existsSync(path.join(reposDir, d, ".git")) || fs.statSync(path.join(reposDir, d)).isDirectory(),
  );
  for (const slug of slugs) {
    const repoPath = path.join(reposDir, slug);
    try {
      const { codeGraph } = await analyzeDirectory(repoPath, ALL_PLUGINS);
      const report = classifySinks(codeGraph);
      const all = report.findings.map(toResult).filter(Boolean);
      const surfaced = report.findings
        .filter((f) => f.reachability !== "unreachable")
        .map(toResult)
        .filter(Boolean);
      for (const [scanner, results] of [["codetrawl-detect", all], ["codetrawl-surfaced", surfaced]] as const) {
        const dir = path.join(outDir, slug, scanner);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "results.json"), JSON.stringify({ results }, null, 2));
      }
      console.log(`  ${slug}: ${all.length} detect, ${surfaced.length} surfaced, ${report.tainted} tainted`);
    } catch (e) {
      console.error(`  ${slug}: FAILED ${(e as Error).message}`);
    }
  }
}
main();
