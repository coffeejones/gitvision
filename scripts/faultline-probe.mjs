#!/usr/bin/env node
// Faultline probe — fire controlled simulate waves at a demo session on prod,
// then read the SERVER-SIDE compute timing (p50/p95/shed) back from the
// founder-metrics tap, so the worker_thread offload decision (Stage 3d) rests
// on data instead of a guess.
//
//   METRICS_TOKEN=<secret> npm run faultline-probe                    # zod demo, prod
//   FILE=path/in/repo.ts SESSION_ID=<demoId> npm run faultline-probe  # another file / session
//   METRICS_URL=http://127.0.0.1:3000 … npm run faultline-probe       # local — use 127.0.0.1,
//                                        # NOT localhost (node fetch prefers ::1 and hangs)
//
// The simulate endpoint is demo-bypassed (no login) but rate-limited to 60/hr
// per IP, so this is a MODEST-VOLUME p95 read — the decision number is the tap's
// per-compute p95, not a saturation stress test. Client round-trip latency
// (printed per wave) includes the network; the tap's p95 is the pure server
// compute the worker decision is actually about.
//
// No dependencies — Node 18+ global fetch only.

import fs from "node:fs";
import path from "node:path";

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
    // No env file — the shell env may still carry what we need.
  }
}
loadEnv(path.join(process.cwd(), ".env.local"));
loadEnv(path.join(process.cwd(), ".env"));

const BASE = (process.env.METRICS_URL ?? "https://codetrawl.com").replace(/\/+$/, "");
const SESSION_ID = process.env.SESSION_ID ?? "qRUWdkTNh-"; // zod demo
const FILE = process.env.FILE ?? "packages/zod/src/v3/types.ts"; // zod's hub file
const TOKEN = process.env.METRICS_TOKEN;

// (concurrency, count) per wave. Total + the validation shot stays under the
// 60/hr per-IP simulate cap so one run doesn't rate-limit itself.
const WAVES = [
  { c: 1, n: 10 },
  { c: 2, n: 14 },
  { c: 4, n: 20 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function percentile(xs, p) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

async function simulateOnce() {
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/api/sessions/${SESSION_ID}/simulate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ changes: [{ path: FILE, newContent: null }] }),
    });
    let body = null;
    try {
      body = await r.json();
    } catch {
      // non-JSON (shouldn't happen)
    }
    return { status: r.status, ms: Date.now() - t0, body };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, body: { error: String(e?.message ?? e) } };
  }
}

async function readTap() {
  if (!TOKEN) return null;
  try {
    const r = await fetch(`${BASE}/api/metrics`, {
      headers: { authorization: `Bearer ${TOKEN}` },
      cache: "no-store",
    });
    if (!r.ok) return null;
    return (await r.json()).faultline ?? null;
  } catch {
    return null;
  }
}

function summarize(b) {
  if (!b) return "no body";
  if (b.ok === false) return `can't-simulate (${b.reason ?? "?"})`;
  if (b.result) return `patched · ${b.result.affectedFiles?.length ?? "?"} affected`;
  if (b.error) return `error: ${b.error}`;
  return "ok";
}

async function main() {
  console.log(`\n  Faultline probe → ${BASE}`);
  console.log(`  session ${SESSION_ID} · delete-sim ${FILE}`);
  console.log(`  simulate is 60/hr per IP — a modest-volume p95 read, not a stress test\n`);

  // 1. Validation shot — make sure this file actually simulates before firing.
  const v = await simulateOnce();
  console.log(`  validation:  HTTP ${v.status} in ${v.ms}ms — ${summarize(v.body)}`);
  if (v.status === 429) {
    console.log("  → already rate-limited (the 60/hr per-IP budget is spent). Wait and retry later.\n");
    return;
  }
  if (v.status === 402) {
    console.log("  → entitlement gate (402). Point SESSION_ID at a DEMO session (zod/flask/gin —");
    console.log("    they bypass Plus); a non-demo session needs a signed-in Plus account.\n");
    return;
  }
  if (v.status === 404) {
    console.log("  → session not found (404). Check SESSION_ID and BASE (default is prod).\n");
    return;
  }
  if (v.status !== 200 || v.body?.ok === false || !v.body?.result) {
    console.log("  → this file did not produce a live simulation. Two usual causes:");
    console.log("    · the demo session hasn't been RE-SWEPT on the new pipeline (no parse layer yet)");
    console.log("    · the path isn't a real analyzed file — open the demo's Faultline tab, pick a");
    console.log("      high-impact file, and pass it:  FILE=<that path> npm run faultline-probe\n");
    return;
  }

  // 2. Waves at rising concurrency. Client-side round-trip latency per wave.
  let fired = 1; // the validation shot counts against the 60/hr budget
  for (const w of WAVES) {
    const lat = [];
    const status = {};
    let done = 0;
    while (done < w.n) {
      const batch = Math.min(w.c, w.n - done);
      const results = await Promise.all(Array.from({ length: batch }, simulateOnce));
      for (const r of results) {
        lat.push(r.ms);
        status[r.status] = (status[r.status] ?? 0) + 1;
      }
      done += batch;
      fired += batch;
    }
    const codes = Object.entries(status)
      .map(([s, n]) => `${s === "0" ? "ERR" : s}×${n}`)
      .join(" ");
    console.log(
      `  wave c=${w.c} n=${w.n}:  client p50 ${percentile(lat, 50)}ms · p95 ${percentile(lat, 95)}ms  [${codes}]`,
    );
    if (status["429"]) {
      console.log("  → hit the 60/hr rate limit; stopping waves early.");
      break;
    }
    await sleep(400);
  }

  // 3. The authoritative number: the tap's SERVER-side compute timing.
  await sleep(600);
  const tap = await readTap();
  console.log("");
  if (!tap) {
    console.log("  server compute: tap unavailable (set METRICS_TOKEN to read p95).\n");
    return;
  }
  console.log("  ── server compute (from the metrics tap) ──");
  console.log(
    `  n=${tap.count}  shed=${tap.shed}  ·  p50 ${tap.p50Ms}ms · p95 ${tap.p95Ms}ms · max ${tap.maxMs}ms`,
  );
  const verdict =
    tap.p95Ms > 1000
      ? "⚠ p95 > 1s — build the worker offload (Stage 3d)"
      : "within budget (p95 ≤ 1s) — the worker stays correctly deferred";
  console.log(`  → ${verdict}`);
  console.log(`  (fired ~${fired} simulates this run; ${tap.shed} shed by the compute gate)\n`);
}

main();
