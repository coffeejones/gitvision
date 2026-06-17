#!/usr/bin/env node
// CodeTrawl founder-metrics CLI. Fetches the token-gated /api/metrics tap and
// prints a terminal dashboard. Runs anywhere (your MacBook) — the data lives on
// prod, this is just a thin reader.
//
//   METRICS_TOKEN=<secret> npm run metrics              # against prod (codetrawl.com)
//   METRICS_TOKEN=<secret> METRICS_URL=http://localhost:3000 npm run metrics
//
// No dependencies — Node 18+ global fetch only.

import fs from "node:fs";
import path from "node:path";

// Plain `node` does NOT read .env.local (that's a Next.js-only thing), so load
// it ourselves — the shell env still wins. Lets you keep METRICS_TOKEN in
// .env.local and just run `npm run metrics`.
function loadEnv(file) {
  try {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (line.trimStart().startsWith("#")) continue;
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const val = m[2].replace(/^(['"])(.*)\1$/, "$2");
      if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    }
  } catch {
    // No env file — fine, the shell env may still have what we need.
  }
}
loadEnv(path.join(process.cwd(), ".env.local"));
loadEnv(path.join(process.cwd(), ".env"));

const TOKEN = process.env.METRICS_TOKEN;
const BASE = (process.env.METRICS_URL ?? "https://codetrawl.com").replace(/\/+$/, "");

if (!TOKEN) {
  console.error(
    "No METRICS_TOKEN found. Put it in .env.local (METRICS_TOKEN=…) or pass it inline:\n" +
      "  METRICS_TOKEN=… npm run metrics"
  );
  process.exit(1);
}

const SPARK = "▁▂▃▄▅▆▇█";
function sparkline(values) {
  const max = Math.max(1, ...values);
  return values.map((v) => SPARK[Math.round((v / max) * (SPARK.length - 1))]).join("");
}
function delta(now, prev) {
  if (prev === 0) return now > 0 ? "(new this week)" : "";
  const d = now - prev;
  if (d === 0) return "(= last week)";
  return `(${d > 0 ? "↑" : "↓"}${Math.abs(d)} vs last week)`;
}
function pad(n) {
  return String(n).padStart(5);
}

async function main() {
  let res;
  try {
    res = await fetch(`${BASE}/api/metrics`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
  } catch (err) {
    console.error(`Could not reach ${BASE}: ${err.message}`);
    process.exit(1);
  }
  if (res.status === 404) {
    console.error(
      "404 — token rejected or METRICS_TOKEN not set on the server. Check the secret matches Railway."
    );
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`Unexpected ${res.status} from ${BASE}/api/metrics`);
    process.exit(1);
  }
  const m = await res.json();

  const host = BASE.replace(/^https?:\/\//, "");
  console.log(`\n  CodeTrawl · ${host}   ${new Date(m.generatedAt).toLocaleString()}\n`);

  console.log("  ACCOUNTS");
  console.log(
    `   ${pad(m.accounts.total)}  total      ${m.accounts.thisWeek} new this week ${delta(m.accounts.thisWeek, m.accounts.prevWeek)}`
  );
  console.log(
    `   ${pad(m.accounts.paid)}  paid       Free ${m.accounts.byTier.Free ?? 0} · Plus ${m.accounts.byTier.Plus ?? 0} · Pro ${m.accounts.byTier.Pro ?? 0}`
  );
  console.log(`   signups/day  ${sparkline(m.signupsByDay.map((d) => d.count))}\n`);

  console.log("  ANALYSES");
  console.log(
    `   ${pad(m.analyses.total)}  total      ${m.analyses.thisWeek} this week ${delta(m.analyses.thisWeek, m.analyses.prevWeek)}`
  );
  console.log(
    `   ${pad(m.analyses.uniqueRepos)}  repos      ${m.analyses.refreshes} re-runs`
  );
  console.log(`   analyses/day ${sparkline(m.analysesByDay.map((d) => d.count))}\n`);

  if (m.topRepos.length) {
    console.log("  TOP REPOS");
    for (const r of m.topRepos) console.log(`   ${pad(r.count)}  ${r.repo}`);
    console.log("");
  }
}

main();
