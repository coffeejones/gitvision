#!/usr/bin/env node
// CodeTrawl MCP benchmark — pilot.
//
// For each task, answers the SAME question with the SAME model under two
// conditions — (A) the codetrawl-mcp tools, (B) a grep+read agent over a local
// clone — then scores each answer against independently-verified ground truth
// with an LLM judge. Measures accuracy, total billed tokens, tool calls, turns,
// and wall-clock. No prompt caching, so input tokens reflect the true per-turn
// billed cost (the grep agent re-sends its growing context every turn — that
// compounding IS the cost being measured).
//
//   ANTHROPIC_API_KEY=… npm run benchmark        # or put the key in .env.local
//
// Spends real Anthropic tokens on your key (pilot ≈ a few dollars).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import Anthropic from "@anthropic-ai/sdk";
import { loadEnvLocal } from "./env.mjs";
import { REPO, TASKS } from "./tasks.mjs";
import { codetrawlProvider, fileProvider } from "./tools.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const WORK = path.join(HERE, ".work");
const MODEL = "claude-opus-4-8";
const MAX_TURNS = 20;
const MAX_TOKENS = 4096;

loadEnvLocal(ROOT);
if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "\n  ✗ ANTHROPIC_API_KEY not found (checked env + .env.local).\n" +
      "    Add a line `ANTHROPIC_API_KEY=sk-ant-…` to .env.local, or export it, then re-run.\n",
  );
  process.exit(1);
}
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const log = (s) => console.log(s);

function setupClone(repo) {
  const dir = path.join(WORK, repo.name.replace(/\//g, "__"));
  if (!fs.existsSync(path.join(dir, ".git"))) {
    fs.mkdirSync(dir, { recursive: true });
    log(`  cloning ${repo.name} …`);
    execFileSync("git", ["clone", "--depth", "1", repo.url, dir], { stdio: "ignore" });
  }
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  if (head !== repo.ref) {
    try {
      execFileSync("git", ["fetch", "--depth", "1", "origin", repo.ref], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["checkout", repo.ref], { cwd: dir, stdio: "ignore" });
    } catch {
      log(`  ! could not pin to ${repo.ref.slice(0, 8)}, using ${head.slice(0, 8)}`);
    }
  }
  return dir;
}

const systemFor = (provider, repo) =>
  provider.label === "codetrawl-mcp"
    ? `You are a code-analysis assistant answering a question about a GitHub repository.\n` +
      `The repository is ${repo.url} at commit ${repo.ref}.\n` +
      `You have the CodeTrawl MCP tools. ALWAYS call analyze_repo FIRST with repoUrl="${repo.url}" and ref="${repo.ref}" to get a sessionId — every other tool needs it.\n` +
      `Gather evidence with the tools, then give your final answer as plain text (no tool call). Be specific and concise; cite files/lines where relevant. Do not narrate your exploration.`
    : `You are a code-analysis assistant answering a question about a repository whose source is available through your tools.\n` +
      `You have list_dir, read_file, and grep over the repository. Gather evidence, then give your final answer as plain text (no tool call). Be specific and concise; cite files/lines where relevant. Do not narrate your exploration.`;

async function runAgent(provider, task, repo) {
  const messages = [{ role: "user", content: task.question }];
  const usage = { input: 0, output: 0 };
  let toolCalls = 0;
  const t0 = performance.now();
  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    let resp;
    try {
      resp = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemFor(provider, repo),
        tools: provider.tools,
        messages,
      });
    } catch (e) {
      return { error: String(e?.message ?? e), usage, toolCalls, turns: turn, ms: performance.now() - t0 };
    }
    usage.input += resp.usage.input_tokens ?? 0;
    usage.output += resp.usage.output_tokens ?? 0;
    messages.push({ role: "assistant", content: resp.content });

    if (resp.stop_reason !== "tool_use") {
      const answer = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      return { answer, usage, toolCalls, turns: turn, ms: performance.now() - t0 };
    }
    const results = [];
    for (const b of resp.content) {
      if (b.type !== "tool_use") continue;
      toolCalls++;
      let out;
      try {
        out = await provider.execute(b.name, b.input);
      } catch (e) {
        out = `ERROR: ${e?.message ?? e}`;
      }
      results.push({ type: "tool_result", tool_use_id: b.id, content: typeof out === "string" ? out : JSON.stringify(out) });
    }
    messages.push({ role: "user", content: results });
  }
  return { answer: "[reached max turns without a final answer]", truncated: true, usage, toolCalls, turns: MAX_TURNS, ms: performance.now() - t0 };
}

async function judge(task, answer) {
  if (!answer) return { score: 0, assessment: "no answer produced" };
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    system:
      "You are a strict, fair grader. You are given a question about a codebase, the VERIFIED correct answer, and a CANDIDATE answer. " +
      "Score the candidate 0-100 on FACTUAL correctness and completeness of the key facts in the verified answer. Ignore writing style, verbosity, and hedging. " +
      "A candidate that states the right key facts scores high even if worded differently; one that omits or contradicts them scores low. Return ONLY a JSON object.",
    messages: [
      {
        role: "user",
        content:
          `QUESTION:\n${task.question}\n\nVERIFIED CORRECT ANSWER:\n${task.groundTruth}\n\nCANDIDATE ANSWER:\n${answer}\n\n` +
          `Return ONLY: {"score": <integer 0-100>, "assessment": "<one sentence on what it got right/wrong>"}`,
      },
    ],
  });
  const text = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const m = text.match(/\{[\s\S]*\}/);
  try {
    const j = JSON.parse(m[0]);
    return { score: Math.max(0, Math.min(100, Number(j.score))), assessment: String(j.assessment ?? "") };
  } catch {
    return { score: null, assessment: "judge parse failed: " + text.slice(0, 120) };
  }
}

function pct(n) {
  return n == null ? "—" : `${n}`;
}
function k(n) {
  return `${(n / 1000).toFixed(1)}k`;
}

async function main() {
  fs.mkdirSync(WORK, { recursive: true });
  const clone = setupClone(REPO);

  log(`\n  benchmark: ${REPO.name} @ ${REPO.ref.slice(0, 8)} · model ${MODEL}\n`);
  const ct = await codetrawlProvider({ env: { ...process.env } });
  const fp = fileProvider(clone);
  log(`  condition A: ${ct.label} (${ct.tools.length} tools)`);
  log(`  condition B: ${fp.label} (${fp.tools.length} tools)\n`);

  const rows = [];
  for (const task of TASKS) {
    log(`  ▶ ${task.id} (${task.kind}, hypothesis favors: ${task.expectFavors})`);
    const record = { id: task.id, kind: task.kind, expectFavors: task.expectFavors, question: task.question, conditions: {} };
    for (const provider of [ct, fp]) {
      const r = await runAgent(provider, task, REPO);
      const scored = r.error ? { score: null, assessment: "run error: " + r.error } : await judge(task, r.answer);
      const total = r.usage.input + r.usage.output;
      record.conditions[provider.label] = {
        score: scored.score,
        assessment: scored.assessment,
        answer: r.answer ?? null,
        error: r.error ?? null,
        tokens: { input: r.usage.input, output: r.usage.output, total },
        toolCalls: r.toolCalls,
        turns: r.turns,
        ms: Math.round(r.ms),
        truncated: r.truncated ?? false,
      };
      log(
        `      ${provider.label.padEnd(14)} score ${pct(scored.score).padStart(3)} · ${k(total).padStart(6)} tok · ${String(r.toolCalls).padStart(2)} calls · ${(r.ms / 1000).toFixed(1)}s${r.error ? " · ERROR" : ""}`,
      );
    }
    rows.push(record);
  }
  await ct.close();

  // ---- render ----------------------------------------------------------
  const A = "codetrawl-mcp";
  const B = "grep+read";
  const line = (r) => {
    const a = r.conditions[A];
    const b = r.conditions[B];
    const ratio = a.tokens.total > 0 ? (b.tokens.total / a.tokens.total).toFixed(1) + "×" : "—";
    return `| ${r.id} | ${r.expectFavors} | ${pct(a.score)} | ${pct(b.score)} | ${k(a.tokens.total)} | ${k(b.tokens.total)} | ${ratio} | ${a.toolCalls}/${b.toolCalls} | ${(a.ms / 1000).toFixed(0)}s / ${(b.ms / 1000).toFixed(0)}s |`;
  };
  const sum = (label, sel) => rows.reduce((n, r) => n + (sel(r.conditions[label]) ?? 0), 0);
  const avg = (label) => {
    const vals = rows.map((r) => r.conditions[label].score).filter((v) => v != null);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  };
  const totA = sum(A, (c) => c.tokens.total);
  const totB = sum(B, (c) => c.tokens.total);

  const md = [
    `# CodeTrawl MCP benchmark — pilot`,
    ``,
    `**Repo:** ${REPO.name} @ \`${REPO.ref.slice(0, 8)}\` · **Model:** ${MODEL} · **Conditions:** \`${A}\` vs \`${B}\` (grep+read agent) · no prompt caching.`,
    `Ground truth verified independently by direct grep/read of the source (see \`tasks.mjs\`). Accuracy scored 0–100 by an LLM judge given the verified answer.`,
    ``,
    `| Task | Favors | Acc: ${A} | Acc: ${B} | Tok: ${A} | Tok: ${B} | Tok ratio (B/A) | Tool calls A/B | Time A/B |`,
    `|---|---|---|---|---|---|---|---|---|`,
    ...rows.map(line),
    `| **avg / total** | | **${avg(A)}** | **${avg(B)}** | **${k(totA)}** | **${k(totB)}** | **${totA > 0 ? (totB / totA).toFixed(1) + "×" : "—"}** | | |`,
    ``,
    `## Per-task detail`,
    ...rows.flatMap((r) => [
      ``,
      `### ${r.id} — ${r.kind} (hypothesis favors: ${r.expectFavors})`,
      `> ${r.question}`,
      ``,
      `- **${A}** — score ${pct(r.conditions[A].score)}, ${k(r.conditions[A].tokens.total)} tok, ${r.conditions[A].toolCalls} calls. _Judge:_ ${r.conditions[A].assessment}`,
      `- **${B}** — score ${pct(r.conditions[B].score)}, ${k(r.conditions[B].tokens.total)} tok, ${r.conditions[B].toolCalls} calls. _Judge:_ ${r.conditions[B].assessment}`,
    ]),
  ].join("\n");

  fs.writeFileSync(path.join(WORK, "results.json"), JSON.stringify({ repo: REPO, model: MODEL, rows }, null, 2));
  fs.writeFileSync(path.join(WORK, "results.md"), md + "\n");
  log(`\n${md}\n`);
  log(`  full results → scripts/benchmark/.work/results.json  (+ results.md)\n`);
}

main().catch((e) => {
  console.error("benchmark failed:", e);
  process.exit(1);
});
