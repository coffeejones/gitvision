// `analyze_repo` MCP tool — the entry point every other tool depends on.
//
// AI agents call this first with a GitHub repo URL. We download the
// tarball, run the full analyze pipeline, cache the resulting
// AnalysisSnapshot under a stable sessionId, and return a JSON summary
// with the bits an agent typically wants for its first read: repo
// metadata, language mix, top hotspots, and the same 17-signal health
// summary that powers the workspace UI.
//
// Subsequent tool calls (blast_radius, find_duplicates, etc.) reuse
// the same sessionId so they hit the cache instead of re-analyzing.

import * as z from "zod/v4";
import { analyzeRepo, parseRepoUrl } from "../../lib/github";
import { parseLayerWriter } from "../../lib/shadowGraph/persist";
import { sessionIdFor, setCached } from "../cache";

export const analyzeRepoInputSchema = {
  repoUrl: z
    .string()
    .describe(
      "GitHub repository URL or owner/repo shorthand (e.g. https://github.com/vercel/next.js or vercel/next.js)"
    ),
  subdir: z
    .string()
    .optional()
    .describe(
      "Optional subdirectory to scope code-analysis to (e.g. 'src/cmd'). Whole-repo metadata still uses the full repo."
    ),
  ref: z
    .string()
    .optional()
    .describe(
      "Optional git ref to analyze — branch name, tag, or commit SHA. Defaults to the repo's default branch. Use this for diff-aware workflows: call analyze_repo on the base ref (e.g. 'main'), then again on the head ref (e.g. 'feature-x'), then pass both session ids to analyze_diff. Distinct refs get distinct session ids so they don't collide in the cache."
    ),
};

const InputSchema = z.object(analyzeRepoInputSchema);
type Input = z.infer<typeof InputSchema>;

export async function handleAnalyzeRepo(input: Input) {
  const parsed = parseRepoUrl(input.repoUrl);
  if (!parsed) {
    return errorResult(
      `Could not parse "${input.repoUrl}" as a GitHub repo. Try the full URL (https://github.com/owner/repo) or shorthand (owner/repo).`
    );
  }

  const sessionId = sessionIdFor(input.repoUrl, input.ref);

  // Run the same pipeline the workspace UI uses. Returns a complete
  // AnalysisSnapshot — every downstream tool can derive what it needs
  // from this one object without further network calls.
  let snapshot;
  try {
    snapshot = await analyzeRepo(parsed.owner, parsed.repo, {
      subdir: input.subdir ?? null,
      ref: input.ref ?? null,
      // Persist the parse layer so a later simulate_change on this session can
      // rebuild the graph incrementally instead of re-analyzing the whole repo.
      onParseLayer: parseLayerWriter({
        repo: `${parsed.owner}/${parsed.repo}`,
        ref: input.ref ?? undefined,
      }),
    });
  } catch (err) {
    return errorResult(
      `Analyze failed for ${parsed.owner}/${parsed.repo}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  await setCached(sessionId, snapshot);

  // Build a compact summary — agents want signal density, not the full
  // ~MB AnalysisSnapshot dumped into their context window. Pull the
  // pieces that drive most "what is this repo?" first reads.
  const summary = {
    sessionId,
    repo: {
      fullName: snapshot.repo.fullName,
      description: snapshot.repo.description,
      language: snapshot.repo.language,
      stars: snapshot.repo.stars,
      defaultBranch: snapshot.repo.defaultBranch,
      pushedAt: snapshot.repo.pushedAt,
      license: snapshot.repo.license,
    },
    /** Echoes the ref that was actually analyzed. When the caller passed
     *  no `ref`, this is undefined — and the analysis used the repo's
     *  default branch. Surfaced so a diff-aware caller can confirm it
     *  got distinct sessions for base vs head. */
    analyzedRef: snapshot.analyzedRef,
    languages: topLanguages(snapshot.languages, 5),
    contributors: snapshot.contributors.length,
    pullRequests: snapshot.pullRequests?.length ?? 0,
    hotspots: snapshot.hotspots.slice(0, 5).map((h) => ({
      path: h.path,
      churn: h.churn,
      authors: h.authors,
    })),
    codeGraph: snapshot.codeGraph
      ? {
          functions: snapshot.codeGraph.functions.length,
          calls: snapshot.codeGraph.calls.length,
          imports: snapshot.codeGraph.imports.length,
          languagesParsed: Object.keys(snapshot.codeGraph.byPlugin).filter(
            (k) =>
              k !== "regex-fallback" &&
              (snapshot.codeGraph?.byPlugin[k]?.files ?? 0) > 0
          ),
        }
      : null,
    codeGraphSkipReason: snapshot.codeGraphSkipReason,
    secretFindings: snapshot.secretFindings
      ? {
          count: snapshot.secretFindings.findings.length,
          critical: snapshot.secretFindings.findings.filter(
            (f) => f.severity === "critical"
          ).length,
          high: snapshot.secretFindings.findings.filter(
            (f) => f.severity === "high"
          ).length,
        }
      : null,
    nextSteps: [
      `Call blast_radius with sessionId='${sessionId}' to see what depends on a given file or function.`,
      `Call find_duplicates with sessionId='${sessionId}' to surface structurally identical functions.`,
      `Call untested_hotspots with sessionId='${sessionId}' for production code without test coverage.`,
      `Call signals with sessionId='${sessionId}' for the full 17-signal health verdict.`,
      `Call simulate_change with sessionId='${sessionId}' and a proposed diff to see what it breaks BEFORE committing (deterministic blast + required actions).`,
    ],
  };

  return jsonResult(summary);
}

// ---------------- helpers ----------------

/** Produce MCP tool result with a JSON-stringified payload. The MCP
 *  spec only allows text content for tool results today; agents
 *  parse JSON from the text themselves. */
function jsonResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

function topLanguages(
  languages: Record<string, number>,
  limit: number
): { name: string; bytes: number }[] {
  return Object.entries(languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, bytes]) => ({ name, bytes }));
}
