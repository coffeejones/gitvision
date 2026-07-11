// Boundary validation for a simulate request's `changes`. Pure — the web
// /simulate route and its test both call it, so the route stays thin and the
// rules are unit-tested in isolation.

import type { FileChange } from "./patch";

export interface ParseChangesOptions {
  /** Max number of changes in one request. */
  maxChanges?: number;
  /** Max characters in a single change path. */
  maxPathLength?: number;
}

const DEFAULTS: Required<ParseChangesOptions> = {
  maxChanges: 100,
  maxPathLength: 400,
};

export type ParseChangesResult =
  | { ok: true; changes: FileChange[] }
  | { ok: false; error: string };

/** A repo-relative path safe to use as a change key: a non-empty string, not
 *  absolute, with no traversal / empty / dot segments, no backslash or NUL. The
 *  patcher never touches the filesystem with these (it works in-memory on parsed
 *  files), so this isn't a sandbox escape guard — it's so junk input gets a clear
 *  400 instead of being silently treated as a phantom added file. */
export function isSafeRelPath(
  p: unknown,
  maxLen = DEFAULTS.maxPathLength,
): p is string {
  if (typeof p !== "string" || p.length === 0 || p.length > maxLen) return false;
  if (p.includes("\0") || p.includes("\\")) return false; // NUL, Windows sep
  if (p.startsWith("/")) return false; // absolute
  for (const seg of p.split("/")) {
    if (seg === "" || seg === "." || seg === "..") return false; // empty / . / ..
  }
  return true;
}

/** Validate a request body's `changes` into a FileChange[], or return a
 *  human-readable error the route surfaces as a 400. */
export function parseSimulateChanges(
  body: unknown,
  opts: ParseChangesOptions = {},
): ParseChangesResult {
  const maxChanges = opts.maxChanges ?? DEFAULTS.maxChanges;
  const maxPathLength = opts.maxPathLength ?? DEFAULTS.maxPathLength;

  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Request body must be a JSON object." };
  }
  const raw = (body as { changes?: unknown }).changes;
  if (!Array.isArray(raw)) {
    return { ok: false, error: "`changes` must be an array." };
  }
  if (raw.length === 0) {
    return { ok: false, error: "`changes` must contain at least one change." };
  }
  if (raw.length > maxChanges) {
    return { ok: false, error: `Too many changes (${raw.length} > ${maxChanges}).` };
  }

  const changes: FileChange[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (typeof c !== "object" || c === null) {
      return { ok: false, error: `changes[${i}] must be an object.` };
    }
    const { path, newContent } = c as { path?: unknown; newContent?: unknown };
    if (!isSafeRelPath(path, maxPathLength)) {
      return {
        ok: false,
        error: `changes[${i}].path is missing or not a safe repo-relative path.`,
      };
    }
    if (newContent !== null && typeof newContent !== "string") {
      return {
        ok: false,
        error: `changes[${i}].newContent must be a string, or null to delete.`,
      };
    }
    if (seen.has(path)) {
      return { ok: false, error: `Duplicate path in changes: ${path}.` };
    }
    seen.add(path);
    changes.push({ path, newContent });
  }
  return { ok: true, changes };
}
