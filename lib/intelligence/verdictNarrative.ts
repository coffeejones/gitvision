// Judge's bench statement via Claude (v0.82+, Phase C-2).
//
// Wraps the deterministic Verdict from verdict.ts in a short prose
// narration written in the voice of a presiding judge announcing the
// court's findings. The prompt grounds itself in the four department
// rulings + their top signals — every claim Claude makes must be
// derivable from that JSON payload. Mirrors the trust chain in
// healthAnalysis.ts: deterministic data → constrained AI prose.
//
// Returns null when ANTHROPIC_API_KEY is unset so the UI can hide
// the panel without special-casing. Knight-tier billing gate lives
// on the caller (the verdict page); this module is unconcerned with
// who can see it.

import Anthropic from "@anthropic-ai/sdk";
import type { Verdict } from "./verdict";

// Haiku 4.5 — same reasoning as aiSummary.ts and healthAnalysis.ts:
// this is a constrained 50-80 word task with a strict format, not a
// reasoning task. Sonnet adds cost without quality gain.
export const VERDICT_NARRATIVE_MODEL = "claude-haiku-4-5";
// Cap output to roughly 1.5× the target word count so the model has
// headroom for short transitions but can't write a full paragraph.
// 200 tokens ≈ 150 words.
const MAX_TOKENS = 200;

const SYSTEM_PROMPT = `You are a presiding judge in a code-review jury, delivering a brief bench statement on a codebase reviewed by four departments: Health Department (overall vital signs), Security Bureau (incidents, vulnerabilities, secrets), Forensics Lab (structural inspection), Supply Office (dependency hygiene and PR flow).

You receive a JSON payload describing:
- the overall outcome (cleared / conditional / returned)
- each department's vote (pass / conditional / fail), the reason, the count of signals considered
- the top contributing signals per department with their titles and severity

Write a 50-80 word bench statement in plain spoken English, as a judge would address the court.

HARD RULES (non-negotiable):
1. 50-80 words. Count before you finish. Not longer.
2. Open by stating the outcome plainly. No flourish.
3. Name the specific departments that drove the outcome, by their full title.
4. Cite at most ONE concrete signal title from the payload as supporting evidence. Don't list everything — pick the most consequential.
5. No corporate-speak, no melodrama, no court-room cliché ("hereby", "verily", "let it be known"). A modern judge talking to a modern courtroom.
6. No markdown. No headings, no bullets, no bold. Plain prose only.
7. Output the statement text only. No preamble, no sign-off.
8. Do NOT invent signals, votes, or details not in the JSON. Stick to what's given.

EXAMPLE TONE (different repo, match the cadence not the content):
"This codebase receives conditional approval. The Health Department and Forensics Lab found no major concerns, but the Supply Office flagged eight outdated packages clustering around the test toolchain. The Security Bureau noted one medium-severity secret pattern in a config file. The court recommends addressing these before the next review window."

Now write the bench statement for the verdict below.`;

export interface VerdictNarrative {
  text: string;
  model: string;
  generatedAt: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

/** Compact projection of the Verdict for the prompt payload. Strips
 *  the helper UI fields (exploreSlug, voteLabel, etc.) so the model
 *  sees only the substance. */
function compactVerdict(verdict: Verdict, repoFullName: string) {
  return {
    repo: repoFullName,
    outcome: verdict.outcome,
    outcomeLabel: verdict.outcomeLabel,
    deterministicSummary: verdict.summary,
    departments: verdict.rulings.map((r) => ({
      title: r.title,
      vote: r.vote,
      reason: r.reason,
      signalCount: r.signalCount,
      topSignals: r.topSignals.map((s) => ({
        title: s.title,
        severity: s.severity ?? null,
      })),
    })),
  };
}

/** Generate the AI bench statement. Returns null when the
 *  ANTHROPIC_API_KEY env var is not set — callers should treat that
 *  as "AI is off, hide the panel" rather than as an error. */
export async function generateVerdictNarrative(
  verdict: Verdict,
  repoFullName: string
): Promise<VerdictNarrative | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const client = new Anthropic();
  const payload = compactVerdict(verdict, repoFullName);

  const response = await client.messages.create({
    model: VERDICT_NARRATIVE_MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content:
          `Verdict for ${repoFullName}:\n\n` + JSON.stringify(payload, null, 2),
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  return {
    text,
    model: VERDICT_NARRATIVE_MODEL,
    generatedAt: new Date().toISOString(),
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}
