// `locate_symbol` MCP tool — "where is symbol X defined?" → file:line.
//
// The missing primitive. blast_radius and untested_hotspots both need you to
// ALREADY know a symbol's file; there was no tool that maps a bare NAME to a
// location. So an agent asked "where is res.download?" had nothing to call and
// guessed a line (off by 100+ in the benchmark). This searches the code graph's
// function/method + class/type definitions by name and returns exact locations.
//
// Lines are 1-INDEXED (startRow + 1). Tree-sitter rows are 0-indexed internally,
// but this tool exists to answer a human/editor question, so it returns the line
// you'd actually open — 435, not 434.

import * as z from "zod/v4";
import type { CodeGraph, ClassDef } from "../../lib/codeAnalysis/types";
import { getCached } from "../cache";

export interface SymbolMatch {
  symbol: string;
  /** function/method (top-level vs class member) or a type definition. */
  kind: "function" | "method" | "class" | "interface" | "enum";
  /** Enclosing class/struct for a method; null for free functions + types. */
  container: string | null;
  file: string;
  /** 1-indexed definition line — ready to open in an editor. */
  line: number;
  /** 1-indexed line the definition ends on. */
  endLine: number;
  complexity?: number;
}

export interface LocateResult {
  matchType: "exact" | "case-insensitive" | "fuzzy" | "none";
  /** How many definitions matched at the returned tier, before `limit`. */
  totalMatched: number;
  matches: SymbolMatch[];
  /** True when a container prefix (e.g. the 'res' in 'res.download') matched no
   *  known class, so results fell back to a name-only search. Common in JS,
   *  where `res.download = ...` assigns to a receiver object, not a class. */
  containerRelaxed?: boolean;
}

/** 0 = exact, 1 = case-insensitive exact, 2 = substring, -1 = no match. */
function rank(candidate: string, query: string): number {
  if (candidate === query) return 0;
  const c = candidate.toLowerCase();
  const q = query.toLowerCase();
  if (c === q) return 1;
  if (c.includes(q)) return 2;
  return -1;
}

const classKind = (c: ClassDef): SymbolMatch["kind"] =>
  c.isEnum ? "enum" : c.isInterface ? "interface" : "class";

/** Pure symbol lookup over a code graph — unit-tested directly. Keeps only the
 *  best match tier (exact hits aren't diluted by substring noise), sorts the
 *  strongest definitions first (complexity desc), and returns 1-indexed lines. */
export function locateSymbol(
  cg: CodeGraph,
  opts: { symbol: string; container?: string; kind?: "function" | "class" | "any"; limit?: number }
): LocateResult {
  // "Container.method" in the symbol is shorthand for container disambiguation.
  const dot = opts.symbol.lastIndexOf(".");
  const parsedContainer = dot > 0 ? opts.symbol.slice(0, dot) : undefined;
  const name = dot > 0 ? opts.symbol.slice(dot + 1) : opts.symbol;
  const container = opts.container ?? parsedContainer;
  const wantKind = opts.kind ?? "any";
  const limit = opts.limit ?? 25;

  const containerMatches = (c?: string) =>
    container != null &&
    c != null &&
    (c === container || c.toLowerCase() === container.toLowerCase());

  // Collect name matches. `applyContainer` gates the container filter so we can
  // retry name-only when a container prefix matches no known class.
  const collect = (applyContainer: boolean): Array<{ r: number; m: SymbolMatch }> => {
    const out: Array<{ r: number; m: SymbolMatch }> = [];
    if (wantKind !== "class") {
      for (const f of cg.functions) {
        const r = rank(f.name, name);
        if (r < 0) continue;
        if (applyContainer && container && !containerMatches(f.containerType)) continue;
        out.push({
          r,
          m: {
            symbol: f.name,
            kind: f.containerType ? "method" : "function",
            container: f.containerType ?? null,
            file: f.filePath,
            line: f.startRow + 1,
            endLine: f.endRow + 1,
            complexity: f.complexity,
          },
        });
      }
    }
    // A container-qualified query targets a member, never a type — skip classes.
    if (wantKind !== "function" && !container) {
      for (const c of cg.classes ?? []) {
        const r = rank(c.name, name);
        if (r < 0) continue;
        out.push({
          r,
          m: {
            symbol: c.name,
            kind: classKind(c),
            container: null,
            file: c.filePath,
            line: c.startRow + 1,
            endLine: c.endRow + 1,
          },
        });
      }
    }
    return out;
  };

  let scored = collect(true);
  let containerRelaxed = false;
  if (scored.length === 0 && container) {
    scored = collect(false);
    containerRelaxed = scored.length > 0;
  }

  if (scored.length === 0) return { matchType: "none", totalMatched: 0, matches: [] };

  const bestRank = Math.min(...scored.map((s) => s.r));
  const tier = scored.filter((s) => s.r === bestRank);
  tier.sort(
    (a, b) =>
      (b.m.complexity ?? 0) - (a.m.complexity ?? 0) ||
      a.m.file.localeCompare(b.m.file) ||
      a.m.line - b.m.line
  );
  const matchType = (["exact", "case-insensitive", "fuzzy"] as const)[bestRank];
  const result: LocateResult = {
    matchType,
    totalMatched: tier.length,
    matches: tier.slice(0, limit).map((s) => s.m),
  };
  if (containerRelaxed) result.containerRelaxed = true;
  return result;
}

export const locateSymbolInputSchema = {
  sessionId: z.string().describe("Session id returned by analyze_repo."),
  symbol: z
    .string()
    .describe(
      "The symbol to locate — a function, method, or class/type name (e.g. 'download', 'res.download', or 'UserService.authenticate'). The dotted 'Container.method' form narrows to a method of that class/struct."
    ),
  container: z
    .string()
    .optional()
    .describe(
      "Optional class/struct/type name to disambiguate a method that exists in several classes (alternative to the dotted 'Container.method' form)."
    ),
  kind: z
    .enum(["function", "class", "any"])
    .optional()
    .describe(
      "Restrict results to functions/methods, to classes/interfaces/enums, or 'any' (default)."
    ),
  limit: z.number().int().min(1).max(50).optional().describe("Cap the match list. Default 25."),
};

const InputSchema = z.object(locateSymbolInputSchema);
type Input = z.infer<typeof InputSchema>;

export async function handleLocateSymbol(input: Input) {
  const snapshot = await getCached(input.sessionId);
  if (!snapshot) {
    return errorResult(
      `Session '${input.sessionId}' not found or expired. Call analyze_repo again with the same repoUrl to refresh.`
    );
  }
  if (!snapshot.codeGraph) {
    return errorResult(
      `This session has no code graph${
        snapshot.codeGraphSkipReason ? ` — ${snapshot.codeGraphSkipReason}` : ""
      }. Symbol location requires AST-parsed source (JS/TS, Python, Go, Java, C#, PHP, or Ruby).`
    );
  }

  const result = locateSymbol(snapshot.codeGraph, {
    symbol: input.symbol,
    container: input.container,
    kind: input.kind,
    limit: input.limit,
  });

  const note =
    result.matchType === "none"
      ? `No definition of '${input.symbol}' found in the parsed code graph. It may live in a regex-fallback language (no function index), be defined dynamically, or not exist.`
      : result.containerRelaxed
        ? "The container prefix didn't match a known class — these are name-only matches (common in JS, where e.g. res.download assigns to a receiver object, not a class). Lines are 1-indexed."
        : result.matchType === "fuzzy"
          ? "No exact-name match — these are substring (fuzzy) matches. Lines are 1-indexed."
          : "Lines are 1-indexed (ready to open in an editor).";

  return jsonResult({ sessionId: input.sessionId, query: input.symbol, ...result, note });
}

// ---------------- helpers ----------------

function jsonResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}
