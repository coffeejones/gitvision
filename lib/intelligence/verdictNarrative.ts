// AI "read" on the grade via Claude (v0.82+, Phase C-2).
//
// Wraps the deterministic Verdict from verdict.ts in a short prose
// narration written in the voice of a senior engineer summarizing the
// grade. The prompt grounds itself in the four lens results + their top
// signals — every claim Claude makes must be derivable from that JSON
// payload. Mirrors the trust chain in healthAnalysis.ts: deterministic
// data → constrained AI prose.
//
// Returns null when ANTHROPIC_API_KEY is unset so the UI can hide
// the panel without special-casing. Plus tier billing gate lives
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

const SYSTEM_PROMPT = `You are a senior engineer writing a short, plain-English read on a codebase that four lenses have just graded: Health (overall vital signs), Security (incidents, vulnerabilities, secrets), Forensics (structural inspection), Supply (dependency hygiene and PR flow).

You receive a JSON payload describing:
- the overall grade (clear / conditional / flagged)
- each lens's result (clear / conditional / flagged), the reason, the count of signals considered
- the top contributing signals per lens with their titles and severity

Write a 50-80 word read in plain spoken English. Direct and grounded — a senior engineer summarizing a review, not a 19th-century melodrama.

HARD RULES (non-negotiable):
1. 50-80 words. Count before you finish. Not longer.
2. Open with a one-line stamp using one of these patterns and only these:
   - clear        → "This repo is clear." / "Clear on all four lenses."
   - conditional  → "Worth a closer look." / "Conditional — a few things to watch."
   - flagged      → "This repo is flagged." / "There's blocking work here."
3. Name the specific lenses that drove the grade (Health / Security / Forensics / Supply).
4. Cite at most ONE concrete signal title from the payload as supporting evidence. Pick the most consequential — don't list.
5. No corporate-speak. No melodrama. No courtroom clichés ("verdict", "the bench", "hereby", "the defendant"). The codebase is the subject, not a defendant.
6. No markdown. No headings, no bullets, no bold. Plain prose only.
7. Output the statement text only. No preamble, no sign-off.
8. Do NOT invent signals, results, or details not in the JSON. Stick to what's given.

EXAMPLE TONE (different repo, match the cadence not the content):
"Worth a closer look. Health and Forensics found no major concerns, but Supply flagged eight outdated packages clustering around the test toolchain, and Security noted one medium-severity secret pattern in a config file. None are blocking, but an owner should clear them before the next review window."

Now write the read for the grade below.`;

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
    lenses: verdict.rulings.map((r) => ({
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
