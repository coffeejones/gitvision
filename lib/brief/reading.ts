// A plain-English reading of one brief — grounded, and told what it cannot see.
//
// Same shape as lib/healthAnalysis.ts: deterministic data in, constrained prose
// out, nothing invented. What is different here, and it is the whole point:
//
//   THE COVERAGE GAPS ARE AN INPUT, NOT A FOOTNOTE.
//
// healthAnalysis instructs the model to write "No pressing risks surfaced in
// the current data" when a bucket is empty. On a Go repo — no dependency
// reader, no dangerous-call rules — that sentence is technically defensible and
// reads as "you are fine". A brief that composes three tabs and then says it
// with confidence is WORSE than the three tabs, because the reader loses the
// chance to notice the empty Packages panel for themselves.
//
// So the gaps go in with the findings, and the prompt requires the model to
// state them. An unchecked repo must come back sounding unchecked.
//
// Returns null without ANTHROPIC_API_KEY, so the brief renders exactly as it
// does today for self-hosters and demos. The reading sits on top of the
// deterministic page; it is never the foundation.

import Anthropic from "@anthropic-ai/sdk";

import type { AnalysisSnapshot } from "../types";
import type { Brief } from "./types";

export const BRIEF_MODEL = "claude-haiku-4-5";
const MAX_TOKENS = 700;

export interface BriefReading {
  /** 2-4 sentences answering the subject's question directly. */
  answer: string;
  /** What the reader should do next, or why there is nothing to do. */
  next: string;
  /** ISO timestamp, so a stale reading can be spotted after a re-sweep. */
  generatedAt: string;
}

const SYSTEM_PROMPT = `You are a senior engineer answering ONE question about a repository for its maintainer, from a deterministic analysis.

You receive:
- "question": the question to answer.
- "sections": findings, already grouped and already ordered by importance. Each item has a title and its evidence.
- "gaps": things the analyzer COULD NOT CHECK on this repository, each with a headline and a detail.

HARD RULES:
- Output VALID JSON ONLY, exactly: {"answer": "...", "next": "..."}
- "answer": 2-4 sentences, 40-80 words. "next": 1-2 sentences, 15-40 words.
- Use ONLY what is in the input. Never invent a finding, a file, a package, a number or a CVE.
- IF "gaps" IS NON-EMPTY YOU MUST SAY SO IN "answer", naming what was not checked. This outranks brevity.
- When there are no findings AND there are gaps, the answer is that the question could NOT be answered — say that plainly. Do not write "no issues found", "looks clean", "nothing concerning", or any phrasing a reader would take as reassurance.
- When there are no findings AND no gaps, say the checks ran and found nothing, and name what ran.
- Never call a pattern match a vulnerability. Never say code "is safe", "is secure", or "will run" — the analysis proves reachability, not execution.
- Cite concrete evidence: file paths, package names, counts, advisory ids that appear in the input.
- Plain technical English. No hype, no alarm, no corporate-speak, no markdown, no preamble.
- Output the JSON object and nothing else.`;

/** The exact payload the model sees. Extracted so a test can assert that gaps
 *  are actually in it — a prompt rule about gaps is worthless if the gaps never
 *  reach the request. */
export function buildReadingInput(
  brief: Brief,
  snap: AnalysisSnapshot,
): Record<string, unknown> {
  return {
    repository: snap.repo?.fullName ?? "unknown",
    question: brief.question,
    sections: brief.sections.map((s) => ({
      label: s.label,
      meaning: s.note,
      items: s.items.map((i) => ({ title: i.title, evidence: i.evidence })),
    })),
    gaps: brief.gaps.map((g) => ({
      headline: g.headline,
      detail: g.detail ?? "",
      blocking: g.kind === "blocking",
    })),
  };
}

export async function generateBriefReading(
  brief: Brief,
  snap: AnalysisSnapshot,
): Promise<BriefReading | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const client = new Anthropic();
  const response = await client.messages.create({
    model: BRIEF_MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: JSON.stringify(buildReadingInput(brief, snap), null, 2),
      },
    ],
  });

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim()
    // Strip fences if the model adds them despite instructions.
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  let parsed: { answer?: unknown; next?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed.answer !== "string" || typeof parsed.next !== "string") {
    return null;
  }

  return {
    answer: parsed.answer,
    next: parsed.next,
    generatedAt: new Date().toISOString(),
  };
}
