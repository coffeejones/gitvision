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
// The "next" line was the one place that leaked. Everything else is bound to
// the input by rule, but "the concrete first move" invited the model to reach
// outside it for advice — on gin it wrote "use a Go-aware tool like nancy or
// go-audit", and go-audit reads auditd logs, it does not scan dependencies.
// Neither name was in the input. On a product whose claim is "nothing is
// invented", a made-up tool name on the one line the reader is meant to ACT on
// is worse than a vague one, so the prompt now names tools, services and
// commands in the do-not-invent list and tells "next" to say what KIND of tool
// to reach for rather than which.
//
// Returns null without ANTHROPIC_API_KEY, so the brief renders exactly as it
// does today for self-hosters and demos. The reading sits on top of the
// deterministic page; it is never the foundation.

import Anthropic from "@anthropic-ai/sdk";

import type { AnalysisSnapshot } from "../types";
import type { Brief } from "./types";

export const BRIEF_MODEL = "claude-haiku-4-5";
const MAX_TOKENS = 1400;

export interface ReadingPoint {
  /** A few words. Scannable on its own — the reader should be able to skim
   *  only the headings and still know what the page is about. */
  heading: string;
  /** 1-3 sentences. Must trace to a finding or a gap that is on the page. */
  body: string;
}

export interface BriefReading {
  /** 1-2 sentences answering the subject's question directly. */
  answer: string;
  /** The reasoning, broken up. Two paragraphs of prose read as a wall and get
   *  skimmed to nothing; headed points can be scanned and then read.
   *
   *  OPTIONAL, because readings generated before this existed have none, and
   *  an old snapshot must keep rendering (AGENTS.md invariant 2). */
  points?: ReadingPoint[];
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
- Output VALID JSON ONLY, exactly:
  {"answer": "...", "points": [{"heading": "...", "body": "..."}], "next": "..."}
- "answer": 1-2 sentences, 20-45 words. The direct answer, nothing else.
- "points": one per thing the reader needs to understand. AS MANY AS THE INPUT
  SUPPORTS, up to five — do not pad to reach five, and do not compress two
  separate things into one point to stay short. Each "heading" is 2-6 words and
  scannable on its own; each "body" is 1-3 sentences.
- Every point must trace to a specific item or gap in the input. Name the file,
  package, count or advisory it comes from.
- "next": 1-2 sentences, 15-40 words — the concrete first move, built from the input like everything else. NEVER name a third-party tool, library, service or command that is not in the input — not even as an example. If the move is to run something we did not run, say what KIND of thing it is ("a Go-aware dependency scanner"), never which one.
- Use ONLY what is in the input. Never invent a finding, a file, a package, a number, a CVE, or the name of a tool, service or command.
- IF "gaps" IS NON-EMPTY YOU MUST SAY SO IN "answer", naming what was not checked, AND one of the points must be about it. This outranks everything else here.
- Write for someone who ships code but has never learned our vocabulary. NEVER use these words: blast radius, reachability, reachable, taint, tainted, sink, fan-in, fan-out, entry point, load-bearing, hotspot, coupling. Say the plain thing instead — "what else breaks if you change it", "a way into the app", "the files most of the project runs through". The NUMBERS stay in; only the jargon goes. Never talk down.
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

  let parsed: { answer?: unknown; points?: unknown; next?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed.answer !== "string" || typeof parsed.next !== "string") {
    return null;
  }

  // Points are dropped rather than trusted loosely: a malformed entry would
  // render as an empty row, which reads as a missing finding.
  const points = Array.isArray(parsed.points)
    ? (parsed.points as unknown[])
        .filter(
          (p): p is ReadingPoint =>
            typeof p === "object" &&
            p !== null &&
            typeof (p as ReadingPoint).heading === "string" &&
            typeof (p as ReadingPoint).body === "string" &&
            (p as ReadingPoint).heading.trim().length > 0 &&
            (p as ReadingPoint).body.trim().length > 0,
        )
        .slice(0, 5)
    : [];

  return {
    answer: parsed.answer,
    points: points.length > 0 ? points : undefined,
    next: parsed.next,
    generatedAt: new Date().toISOString(),
  };
}
