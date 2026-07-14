// Source-view fetch layer (Stage 1 of the read-only "Source" code view).
//
// CodeTrawl never persists source (tarball → parse → discard; "we keep the
// findings, never your files"). So the Source view fetches ONE analyzed file's
// contents live from GitHub, pinned to the exact commit we analyzed, and streams
// it to the client without storing it. This module holds the two pure-ish
// pieces the route composes: the GitHub fetch (typed errors, size-guarded) and
// the integrity check that proves the fetched bytes are the ones we annotated.

import { djb2 } from "@/lib/codeAnalysis/fileUniverse";

/** GitHub's Contents API stops returning inline content above 1 MB (it flips to
 *  encoding "none" and you'd need the blob API). Analyzed files are already under
 *  the analyzer's own size cap, so anything above this is treated as undisplayable
 *  rather than special-cased. */
export const MAX_SOURCE_BYTES = 1024 * 1024; // 1 MB

/** Minimal structural view of the one Octokit call we make — kept loose because
 *  Octokit's own generated types churn (and shift the getContent overloads). The
 *  route passes a real Octokit via a cast; tests pass a fake. */
export interface SourceOctokit {
  rest: {
    repos: {
      getContent(args: {
        owner: string;
        repo: string;
        path: string;
        ref: string;
      }): Promise<{ data: unknown }>;
    };
  };
}

export type FetchSourceError =
  | "not-a-file" // path resolved to a directory / submodule / symlink
  | "too-large" // above MAX_SOURCE_BYTES (or the API's inline-content ceiling)
  | "not-found" // 404 — file gone at this ref, or the ref was GC'd
  | "forbidden"; // 403/429 — rate limit or access declined

export type FetchSourceResult =
  | { ok: true; content: string; ext: string; bytes: number }
  | { ok: false; error: FetchSourceError };

/** Lowercase extension without the dot, e.g. "src/a/Foo.TS" → "ts". "" if none. */
export function extOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** Fetch one file's UTF-8 source from GitHub at a pinned ref. Returns a typed
 *  error rather than throwing for the expected cases (missing file, too large,
 *  declined); only genuinely-unexpected errors propagate. */
export async function fetchFileSource(
  octokit: SourceOctokit,
  args: {
    owner: string;
    repo: string;
    path: string;
    ref: string;
    maxBytes?: number;
  },
): Promise<FetchSourceResult> {
  const maxBytes = args.maxBytes ?? MAX_SOURCE_BYTES;

  let data: unknown;
  try {
    ({ data } = await octokit.rest.repos.getContent({
      owner: args.owner,
      repo: args.repo,
      path: args.path,
      ref: args.ref,
    }));
  } catch (err) {
    const status = (err as { status?: number } | null)?.status;
    if (status === 404) return { ok: false, error: "not-found" };
    if (status === 403 || status === 429) return { ok: false, error: "forbidden" };
    throw err;
  }

  // A path can resolve to a directory (array), a submodule, or a symlink.
  if (Array.isArray(data) || typeof data !== "object" || data === null) {
    return { ok: false, error: "not-a-file" };
  }
  const d = data as {
    type?: string;
    content?: string;
    encoding?: string;
    size?: number;
  };
  if (d.type !== "file" || typeof d.content !== "string") {
    return { ok: false, error: "not-a-file" };
  }
  // Above 1 MB the API returns size but empty content with encoding "none".
  if (
    (typeof d.size === "number" && d.size > maxBytes) ||
    d.encoding !== "base64" ||
    d.content === ""
  ) {
    return { ok: false, error: "too-large" };
  }

  const content = Buffer.from(d.content, "base64").toString("utf-8");
  const bytes = Buffer.byteLength(content, "utf-8");
  if (bytes > maxBytes) return { ok: false, error: "too-large" };

  return { ok: true, content, ext: extOf(args.path), bytes };
}

/** Prove the fetched bytes are the exact ones we analyzed: the stored
 *  contentHash is `djb2(rawSource)` from analysis time. Match → the annotations
 *  (function spans, hotspots) are line-accurate. Mismatch → the file changed at
 *  that path since analysis (force-push, or a genuinely different ref), so the
 *  caller must drop line-anchored markers. */
export function isAligned(content: string, expectedHash: string): boolean {
  return djb2(content) === expectedHash;
}
