// Structural hash of a tree-sitter AST subtree (v0.30). Used by all AST
// plugins to fingerprint function bodies so duplicates.ts can find
// near-identical functions across the codebase.
//
// Design goals:
//   - Two functions that do the same thing with different identifier
//     names hash identically. (We never read identifier text.)
//   - Two functions with the same shape but different operators hash
//     differently. (`a + b` vs `a * b` are NOT duplicates.)
//   - Two functions with different control flow hash differently.
//     (`if (x) y` vs `while (x) y` produce distinct shapes.)
//   - Hash is deterministic across runs and stable across snapshot
//     generations for the same input.
//
// Algorithm: pre-order DFS over node.namedChildren, accumulating
// node.type into a string buffer. For binary_expression and
// assignment_expression we additionally append the operator's text
// — those nodes' meaning depends on the operator, not just the shape.
// FNV-1a 64-bit hash on the resulting buffer; output as 16 hex chars.
//
// Cross-language note: each plugin runs this on its own language's AST
// nodes. JS's `binary_expression` and Java's `binary_expression` happen
// to share names but emit different sub-shapes — duplicates only match
// within a single language. That's intentional; cross-language
// "duplicates" aren't actionable refactor targets anyway.

import type { Node as TsNode } from "web-tree-sitter";

// FNV-1a 64-bit constants (RFC reference values). Using BigInt()
// constructor instead of bigint literals (`123n` syntax) since our
// tsconfig target is ES2017 — Node has full BigInt support either
// way, but the literal syntax requires ES2020+.
const FNV_OFFSET_64 = BigInt("0xcbf29ce484222325");
const FNV_PRIME_64 = BigInt("0x100000001b3");
const MASK_64 = BigInt("0xffffffffffffffff");

/** FNV-1a 64-bit hash of an arbitrary string. Returns 16 hex chars. */
function fnv1a64(input: string): string {
  let hash = FNV_OFFSET_64;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * FNV_PRIME_64) & MASK_64;
  }
  return hash.toString(16).padStart(16, "0");
}

/** Build the hashable string by walking the subtree in pre-order. */
function buildSignature(node: TsNode, parts: string[]): void {
  parts.push(node.type);
  // Operator-bearing expression nodes: their behavior depends on which
  // operator they hold. Capture it explicitly so `a + b` (`+`) and
  // `a * b` (`*`) get different hashes despite identical AST shapes.
  if (
    node.type === "binary_expression" ||
    node.type === "assignment_expression" ||
    node.type === "augmented_assignment_expression" ||
    node.type === "operator_assignment" ||
    node.type === "compound_assignment_expr" ||
    node.type === "unary_expression"
  ) {
    const op = node.childForFieldName("operator")?.text;
    if (op) {
      parts.push(`@${op}`);
    } else {
      // Some grammars expose the operator as an unnamed child rather
      // than via a named field. Walk the children list once to find
      // the first non-whitespace token. Cheap fallback.
      for (const child of node.children) {
        if (!child.isNamed) {
          parts.push(`@${child.type}`);
          break;
        }
      }
    }
  }
  // Recurse into named children — unnamed tokens (parens, semicolons,
  // braces) are excluded since they're shape-noise that cancels out
  // across all blocks.
  for (const child of node.namedChildren) {
    buildSignature(child, parts);
  }
}

/** Compute the structural hash of a tree-sitter subtree. Used by AST
 *  plugins to fingerprint function bodies for duplicate detection.
 *  Returns a 16-character hex string. */
export function hashSubtree(node: TsNode): string {
  const parts: string[] = [];
  buildSignature(node, parts);
  // "|" is a separator that can't appear in any tree-sitter node.type
  // we've encountered (node types are identifiers like "if_statement",
  // "binary_expression", etc.). Using it ensures node-type boundaries
  // don't collide accidentally.
  return fnv1a64(parts.join("|"));
}

/** Internal helper exposed for tests — same hashing logic over an
 *  arbitrary string buffer. Lets us verify FNV-1a behavior without
 *  setting up tree-sitter. */
export const _fnv1a64ForTest = fnv1a64;
