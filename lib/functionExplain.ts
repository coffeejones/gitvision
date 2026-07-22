// Per-function AI risk explainer for the Source view — the source-aware layer
// that reads ONE function AND its computed signals, then narrates "what it does
// / where the risk is / one grounded next step".
//
// Grounded-frame invariant (AGENTS.md #3): the model reads the source, but its
// output is anchored to deterministic signals we hand it alongside. It LEADS
// with the facts we computed and ties every risk/suggestion back to one. This
// keeps CodeTrawl's "computed, not guessed" character as the FRAME, with the
// source-aware reading as a layer on top — not a free-floating AI opinion. It's
// the one place we trade the strict signals-only grounding of the Health Check
// for richer, code-aware feedback; the prompt does the constraining.
//
// Privacy: unlike the rest of the pipeline, this transmits the function's source
// to Anthropic — on the user's explicit click, one function at a time. It is
// NEVER stored: the result lives only in an in-memory read-through cache
// (functionExplainCache.ts). The Source view discloses the transmission at the
// point of action. Returns null when ANTHROPIC_API_KEY is unset so callers hide
// the feature without special-casing.

import Anthropic from "@anthropic-ai/sdk";
import type { FnMarker } from "./sourceAnnotations";

// FunctionSignals + its pure builder now live in a client-safe module (they carry
// no SDK dependency), so the Source view's FunctionInsight can build the evidence
// row on the client. Re-exported here so existing server-side importers (the
// explain route, the cache) keep importing from functionExplain unchanged.
export { buildFunctionSignals } from "./functionSignals";
export type { FunctionSignals } from "./functionSignals";
import type { FunctionSignals } from "./functionSignals";

// Haiku 4.5 — same call as the Health Check + summary: a constrained "read this
// + these numbers, write three short grounded sentences" task, not deep
// reasoning. If the source-aware SUGGESTION quality proves too thin (the whole
// point of reading the source), bump to Sonnet — it's a one-line change and the
// aiBudget kill-switch bounds the cost either way.
export const EXPLAIN_MODEL = "claude-haiku-4-5";
const MAX_TOKENS = 500;

// Bound the tokens we spend on a pathological function. Past this the model has
// more than enough to characterise it; we truncate and tell it we did.
const MAX_SOURCE_LINES = 400;
const MAX_SOURCE_CHARS = 16_000;

export interface FunctionExplanation {
  /** One plain sentence: what the function does. */
  does: string;
  /** Why it's risky to change, anchored to a signal. */
  risk: string;
  /** At most one concrete next step tied to a signal, or null for a clean fn. */
  suggestion: string | null;
  model: string;
  generatedAt: string;
  usage: { inputTokens: number; outputTokens: number };
}

const SYSTEM_PROMPT = `You are a senior engineer helping a developer who is reading ONE function in an unfamiliar codebase. You are given the function's source AND a set of deterministic signals a static analyzer already computed about it (complexity, how many places call it, whether a test reaches its file, whether its body is duplicated elsewhere, how much the file churns, whether one author owns it). Treat those signals as ground truth — they are computed, not guessed.

Write a short, grounded explanation in THREE parts:

1. "does" — one plain sentence: what THIS function actually does. Read the source; be specific to this code, not generic boilerplate.

2. "risk" — why it's risky to change, ANCHORED to the signals. Lead with the strongest one (highest complexity, most callers, no test, duplication, bus factor). Cite the real numbers you were given. If the signals show no real risk, say so plainly — do not manufacture concern.

3. "suggestion" — AT MOST ONE concrete next step, and ONLY when it's tied to a signal or something clearly visible in the source. Good examples: "extract the block that's duplicated in the other N copies", "add a guard test before touching it — N callers depend on it", "this fetches, transforms, and formats in one place; the formatting could move out". You MAY observe that the function mixes responsibilities visible in its own body — e.g. "this request handler also runs the query and formats the response; the data access typically belongs in a service/repository layer rather than the controller." But you may NOT name or assume a specific module, file, class, function, or abstraction you cannot see, and you may NOT claim any destination already exists. If there is no honest, specific suggestion, return null. Do NOT invent a refactor for a clean function.

HARD RULES (break one and the output is unusable):
- Output VALID JSON ONLY, this exact shape: {"does": "...", "risk": "...", "suggestion": "..."} where suggestion is a string or null.
- Each string is 1-2 sentences, under 40 words.
- Ground every risk claim in a signal you were given or something concretely present in the source. NEVER invent a signal — do not say it's called from many places unless the caller count says so, do not claim it's untested unless the signal says so.
- A signal shown as "not computed" (or a field that is absent) means the analyzer did NOT determine it. Never cite a "not computed" value as evidence. In particular, a test signal that is not exactly false does NOT mean the code is untested — do not claim it is untested, and do not infer churn, a safety tier, or single-author risk from a "not computed" value.
- "resolvedCallSites" counts statically-resolved call sites only; it is a LOWER BOUND (dynamic, cross-file, or cross-language calls may be missed). Never conclude a function is "safe to change" or "only called once" from a low resolvedCallSites value alone.
- Do NOT rewrite the function or output any code block. Describe, point, and suggest — never a full rewrite.
- No markdown, no headings, no preamble, no backticks except around a real identifier.
- Honesty over filler: a trivial, safe function should get a short honest "risk" and a null "suggestion".
- Output the JSON object and nothing else.`;

/** Extract a function's source from the file's full text by its 0-indexed row
 *  span. Truncates a pathological function to bound the token spend, appending a
 *  marker so the model knows the tail is missing. */
export function sliceFunctionSource(fileContent: string, marker: FnMarker): string {
  const lines = fileContent.split("\n");
  const start = Math.max(0, marker.startRow);
  const end = Math.min(lines.length - 1, marker.endRow);
  let slice = lines.slice(start, end + 1);
  let truncated = false;
  if (slice.length > MAX_SOURCE_LINES) {
    slice = slice.slice(0, MAX_SOURCE_LINES);
    truncated = true;
  }
  let text = slice.join("\n");
  if (text.length > MAX_SOURCE_CHARS) {
    text = text.slice(0, MAX_SOURCE_CHARS);
    truncated = true;
  }
  return truncated ? `${text}\n… (function truncated for length)` : text;
}

/** The grounded, source-aware explanation for one function. Returns null when
 *  the API key is unset (feature disabled). Throws only on a genuine API error,
 *  which the route maps to a 502. */
export async function explainFunction(
  source: string,
  signals: FunctionSignals,
  ext: string,
): Promise<FunctionExplanation | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const client = new Anthropic();
  // Render "unknown" signals as an explicit sentinel, never a bare JSON `null` —
  // a null is the most reliable LLM misread (a not-computed test signal read as
  // "untested"). The prompt is told to ignore "not computed".
  const NC = "not computed";
  const payload = {
    complexity: signals.complexity,
    changedSinceLastSweep: signals.changed ?? NC,
    structuralDuplicatesElsewhere: signals.duplicateCount,
    // A lower bound (resolved static call sites only) — the key name + a HARD
    // RULE tell the model not to read "safe" into a low value.
    resolvedCallSites: signals.callerCount,
    fileRefactorTier: signals.fileTier ?? NC,
    fileReachedByATest: signals.fileTested ?? NC,
    filesDependingOnThisFile: signals.fileFanIn,
    fileCommits: signals.churn ?? NC,
    // Only a real bus-factor signal when we actually have git history; with no
    // history the author count is unknown, not "many".
    singleAuthorFile: signals.churn == null ? NC : signals.soloAuthor,
  };
  const userContent =
    `Function \`${signals.name}\` at ${signals.path}:${signals.line}\n\n` +
    `Deterministic signals (ground truth):\n${JSON.stringify(payload, null, 2)}` +
    `\n\nSource:\n\`\`\`${ext}\n${source}\n\`\`\``;

  const response = await client.messages.create({
    model: EXPLAIN_MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  const rawText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  // Strip markdown fences if the model added them despite instructions.
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  let does = "";
  let risk = "";
  let suggestion: string | null = null;
  try {
    const parsed = JSON.parse(cleaned) as {
      does?: unknown;
      risk?: unknown;
      suggestion?: unknown;
    };
    does = typeof parsed.does === "string" ? parsed.does : "";
    risk = typeof parsed.risk === "string" ? parsed.risk : "";
    // Accept a string; coerce anything else (null, "", "none", "null") to null
    // so the UI can cleanly hide the suggestion row.
    if (typeof parsed.suggestion === "string") {
      const s = parsed.suggestion.trim();
      suggestion = s && !/^(null|none|n\/a)$/i.test(s) ? s : null;
    }
  } catch {
    // Non-JSON: surface the raw text in `risk` rather than failing silently, so
    // the user sees something and we can spot a prompt regression.
    risk = `Model returned an unparseable response: ${cleaned.slice(0, 300)}`;
  }

  return {
    does,
    risk,
    suggestion,
    model: EXPLAIN_MODEL,
    generatedAt: new Date().toISOString(),
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}
