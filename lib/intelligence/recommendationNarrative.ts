// AI "where to start" note over the deterministic recommendations (block 1.4).
//
// Turns the computed, prioritized Recommendations (lib/recommendations.ts) into
// a short prose plan — what to do first and why — in the voice of a senior
// engineer. This is the Plus-tier polish ON TOP OF the free deterministic list;
// the cards stand on their own, this just sequences them into a paragraph.
//
// The hard contract (same trust chain as healthAnalysis.ts / verdictNarrative.ts):
// the model only REPHRASES and SEQUENCES the recommendations it is given. It
// must not invent advice, files, or numbers that aren't already in the list —
// every recommendation was itself grounded in a measured signal, so this layer
// inherits that grounding and may not add to it.
//
// Returns null when ANTHROPIC_API_KEY is unset, when there are no
// recommendations to summarize, or on ANY Anthropic failure — callers treat
// null as "hide the prose, show the cards" rather than as an error. The Plus
// tier gate lives on the caller (the verdict page).

import Anthropic from "@anthropic-ai/sdk";
import type { Recommendations } from "../recommendations";

// Haiku 4.5 — same reasoning as the sibling narrative generators: a constrained,
// short-format rewrite, not a reasoning task.
export const RECOMMENDATION_NARRATIVE_MODEL = "claude-haiku-4-5";
// ~110-word target with headroom for transitions.
const MAX_TOKENS = 240;

const SYSTEM_PROMPT = `You are a senior engineer writing a short "where to start" note for a developer who just received an automated review of their repository. You receive a JSON list of computed, prioritized recommendations — each already carries a concrete action and the reason it matters, grounded in a measured signal.

Write a 60-110 word note that turns the list into a plan: what to tackle first and why, in plain spoken English.

HARD RULES (non-negotiable):
1. 60-110 words. Count before you finish. Not longer.
2. Use ONLY the recommendations in the payload. Do NOT add advice, files, packages, or numbers that aren't there. You are summarizing and sequencing, not inventing.
3. Lead with the highest-priority item(s). Cite the specific files / packages / counts from those recommendations as evidence. You may fold the lower-priority ones into a single closing clause.
4. Plain, direct senior-engineer voice. No corporate-speak, no melodrama, no courtroom clichés ("verdict", "the bench", "hereby").
5. No markdown — no headings, bullets, or bold. Plain prose only.
6. Output the note text only. No preamble, no sign-off.

EXAMPLE TONE (different repo, match the cadence not the content):
"Start with the security work: three runtime dependencies carry known CVEs, and that's the most exposed surface here. Next, the two single-maintainer folders under src/core — pair on them before the knowledge calcifies. The deep import chain and the year-behind packages can wait for a quieter week, but don't let them slide past the next release."

Now write the note for the recommendations below.`;

export interface RecommendationNarrative {
  text: string;
  model: string;
  generatedAt: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

/** Compact projection for the prompt — the substance of each recommendation,
 *  capped to the top few so the model focuses on what to do first. */
function compactRecommendations(
  recommendations: Recommendations,
  repoFullName: string
) {
  return {
    repo: repoFullName,
    recommendations: recommendations.items.slice(0, 8).map((r) => ({
      title: r.title,
      action: r.action,
      why: r.why,
      category: r.category,
      severity: r.severity ?? null,
      effort: r.effort,
      priority: r.priority,
    })),
  };
}

/** Generate the AI "where to start" note. Returns null when the
 *  ANTHROPIC_API_KEY is unset, when there is nothing to summarize, or on ANY
 *  Anthropic failure — this runs INLINE during the verdict page render, so an
 *  uncaught throw would crash the page into a 500. Callers render the prose
 *  only when this is truthy, so a transient outage degrades to "cards only". */
export async function generateRecommendationNarrative(
  recommendations: Recommendations,
  repoFullName: string
): Promise<RecommendationNarrative | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (recommendations.items.length === 0) return null;

  try {
    const client = new Anthropic();
    const payload = compactRecommendations(recommendations, repoFullName);

    const response = await client.messages.create({
      model: RECOMMENDATION_NARRATIVE_MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content:
            `Recommendations for ${repoFullName}:\n\n` +
            JSON.stringify(payload, null, 2),
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
      model: RECOMMENDATION_NARRATIVE_MODEL,
      generatedAt: new Date().toISOString(),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  } catch (err) {
    console.error(
      `[recommendationNarrative] generation failed for ${repoFullName}:`,
      err
    );
    return null;
  }
}
