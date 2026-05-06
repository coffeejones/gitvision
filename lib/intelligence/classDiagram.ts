// Class-diagram Mermaid generator (v0.70 / Architecture Phase 1).
//
// Renders a CodeGraph's class extraction as Mermaid `classDiagram`
// source. Pure function — no DOM, no I/O, no AI. Output is a string
// the user can paste into mermaid.live, embed in a README, or pipe
// through a Mermaid CLI to generate SVG/PNG.
//
// Scope filtering is built in: pass `{ filePath: "src/auth.ts" }`
// to limit the diagram to one file, or `{ folder: "src/auth" }` to
// limit to one folder. Without scope, all classes render — fine
// for small repos, overwhelming for large ones (a 600-class
// codebase produces 3000+ lines of Mermaid).
//
// We use Mermaid's class-diagram syntax over the alternatives
// (DOT/Graphviz, PlantUML) because it's the de-facto standard for
// inline-in-Markdown rendering and ships natively in GitHub
// flavoured markdown.

import type {
  ClassDef,
  ClassMemberVisibility,
  CodeGraph,
  ParsedField,
} from "../codeAnalysis/types";

export type ClassDiagramScope =
  | { kind: "all" }
  | { kind: "file"; filePath: string }
  | { kind: "folder"; folder: string };

export interface ClassDiagramOptions {
  /** Limit which classes get rendered. Default: all classes in cg. */
  scope?: ClassDiagramScope;
  /** Cap on classes rendered. Mermaid breaks down past a few
   *  hundred entities; keep diagrams scannable. Default 60. */
  maxClasses?: number;
}

export interface ClassDiagramResult {
  /** Ready-to-paste Mermaid source. Always starts with the
   *  `classDiagram` directive. */
  source: string;
  /** How many classes the source contains (after scope + cap). */
  classCount: number;
  /** Total classes available in the CodeGraph (before scope + cap)
   *  — drives "showing N of M" UI hints. */
  totalAvailable: number;
  /** Set when the cap kicked in OR when scope filtered everything
   *  out. UI uses this to surface a hint. */
  truncated?: string;
}

/** Cap on classes rendered in one diagram. Lifted from 60 to 250
 *  in v0.70 polish — capping silently was hiding real architecture
 *  (a 173-class repo only saw 60), eroding trust in the diagram.
 *  At 250 we cover virtually every real-world repo we've seen
 *  during alpha; very large monorepos still get the truncation
 *  hint surfaced in the result so the UI can recommend scope
 *  filtering. */
const DEFAULT_MAX_CLASSES = 250;

export interface ScopeOption {
  /** Folder path the option represents. Empty string for the
   *  repo root (which we render as "All" in the UI). */
  folder: string;
  /** How many classes live within this folder (recursively). Drives
   *  the count badge in the scope dropdown. */
  classCount: number;
}

/** Compute the dropdown options for the Architecture tab's scope
 *  filter. Walks every class in the CodeGraph, tallies which
 *  folders contain how many, and returns the top-N folders sorted
 *  by class count descending. The empty-string entry (the "all"
 *  option) is NOT included — the caller adds it explicitly so it
 *  always sits at the top of the dropdown. */
export function computeScopeOptions(
  cg: CodeGraph,
  limit: number = 25
): ScopeOption[] {
  const allClasses = cg.classes ?? [];
  if (allClasses.length === 0) return [];

  const folderCounts = new Map<string, number>();
  for (const cls of allClasses) {
    // Walk parent folders so every ancestor gets credit. A class
    // at "lib/intelligence/headline.ts" counts toward "lib" AND
    // "lib/intelligence". Drives the dropdown's nested feel
    // without needing explicit tree state.
    const parts = cls.filePath.split("/");
    parts.pop(); // drop the filename
    let path = "";
    for (const part of parts) {
      path = path ? `${path}/${part}` : part;
      folderCounts.set(path, (folderCounts.get(path) ?? 0) + 1);
    }
  }

  return [...folderCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([folder, classCount]) => ({ folder, classCount }));
}

/** Generate Mermaid class-diagram source from a CodeGraph. */
export function generateClassDiagram(
  cg: CodeGraph,
  opts: ClassDiagramOptions = {}
): ClassDiagramResult {
  const allClasses = cg.classes ?? [];
  const totalAvailable = allClasses.length;
  const maxClasses = opts.maxClasses ?? DEFAULT_MAX_CLASSES;

  const scoped = filterByScope(allClasses, opts.scope ?? { kind: "all" });
  const trimmed = scoped.slice(0, maxClasses);

  if (trimmed.length === 0) {
    return {
      source: "classDiagram\n  %% No classes found in scope",
      classCount: 0,
      totalAvailable,
      truncated:
        scoped.length === 0 && totalAvailable > 0
          ? "Scope filter matched no classes — try a different file or folder."
          : undefined,
    };
  }

  // Deduplicate class names that we'll reference from inheritance
  // arrows. Mermaid auto-creates a placeholder class node when an
  // arrow references an unknown name; that's fine for external
  // parents (e.g. extends from a library) but means we should only
  // emit `Foo <|-- Bar` once even if multiple subclasses of Foo
  // exist in scope.
  const lines: string[] = ["classDiagram"];
  const renderedNames = new Set(trimmed.map((c) => c.name));

  for (const cls of trimmed) {
    lines.push(...renderClassBlock(cls));
  }

  // Inheritance arrows — emitted after all class blocks so the
  // class definitions are clearly grouped together.
  for (const cls of trimmed) {
    if (cls.parentClass) {
      lines.push(`  ${cls.parentClass} <|-- ${cls.name}`);
    }
    for (const iface of cls.implements ?? []) {
      lines.push(`  ${iface} <|.. ${cls.name}`);
    }
  }

  // Trace-not-found message: if any inheritance arrow references a
  // name we didn't render, Mermaid still works but the diagram
  // shows orphan boxes. That's the desired behavior — it tells the
  // reader "these classes inherit from something outside this
  // scope" — but we hint at it in the result for the UI.
  let truncated: string | undefined;
  if (scoped.length > trimmed.length) {
    truncated = `Capped at ${maxClasses} classes — repo has ${scoped.length} in scope.`;
  } else if (anyExternalRefs(trimmed, renderedNames)) {
    truncated =
      "Diagram shows classes whose parent / interface is outside the current scope (rendered as orphan boxes by Mermaid).";
  }

  return {
    source: lines.join("\n"),
    classCount: trimmed.length,
    totalAvailable,
    truncated,
  };
}

// ---------------- Internals ----------------

function filterByScope(
  classes: ClassDef[],
  scope: ClassDiagramScope
): ClassDef[] {
  switch (scope.kind) {
    case "all":
      return classes;
    case "file":
      return classes.filter((c) => c.filePath === scope.filePath);
    case "folder": {
      const folder = scope.folder.replace(/\/$/, "");
      return classes.filter(
        (c) =>
          c.filePath === folder ||
          c.filePath.startsWith(`${folder}/`)
      );
    }
  }
}

function renderClassBlock(cls: ClassDef): string[] {
  const lines: string[] = [];
  const safeName = sanitizeIdentifier(cls.name);

  // Mermaid stereotype lines tag the class as `<<interface>>` or
  // `<<abstract>>`; they appear inside the class body.
  lines.push(`  class ${safeName} {`);
  if (cls.isInterface) {
    lines.push(`    <<interface>>`);
  } else if (cls.isAbstract) {
    lines.push(`    <<abstract>>`);
  }

  for (const field of cls.fields) {
    lines.push(`    ${renderField(field)}`);
  }

  // Methods are intentionally NOT rendered in v0.70. We have method
  // names but no parameter signatures or return types yet — emitting
  // `+login()` for a real `login(password: string): Token` would
  // mislead readers more than help them. Method rendering returns in
  // a later phase once we extract param/return data into FunctionDef.

  lines.push(`  }`);

  // File-path note attached below the class block. Lets the reader
  // jump from the diagram back to source without guessing — esp.
  // important when names are disambiguated (Props_HeadlineFinding
  // tells you the suffix; the note tells you "components/HeadlineFinding.tsx").
  // Mermaid renders these as small annotation boxes connected to
  // the class with a dotted line.
  lines.push(`  note for ${safeName} "${escapeNoteText(cls.filePath)}"`);

  return lines;
}

function renderField(field: ParsedField): string {
  const vis = visToMermaid(field.visibility);
  const staticTag = field.isStatic ? "$" : "";
  // Type follows the field name in Mermaid (`+name string`,
  // `-passwordHash : string`). The colon is optional but reads
  // better — and matches what the api-vision strategy doc
  // recommends for shareability.
  const typeStr = field.type ? ` ${escapeAngleBrackets(field.type)}` : "";
  const readonlyTag = field.isReadonly ? "*" : "";
  return `${vis}${staticTag}${readonlyTag}${field.name}${typeStr}`;
}

function visToMermaid(v: ClassMemberVisibility): string {
  switch (v) {
    case "public":
      return "+";
    case "private":
      return "-";
    case "protected":
      return "#";
    case "internal":
      return "~";
  }
}

/** Mermaid identifiers can't contain ., <, > or other special
 *  chars. Class names usually don't, but generic types might
 *  appear in the parser's output (e.g. `Map<K,V>`). Strip them
 *  defensively so the diagram still parses. */
function sanitizeIdentifier(name: string): string {
  return name.replace(/[<>,. \t]/g, "_");
}

/** Mermaid uses < and > as part of its syntax (stereotypes,
 *  arrows). When a type contains them — `Map<K,V>` — they have to
 *  be escaped or Mermaid mis-parses the line. We replace with
 *  HTML-style entities; Mermaid renders those as the literal
 *  characters in the final output. */
function escapeAngleBrackets(s: string): string {
  return s.replace(/</g, "~").replace(/>/g, "~");
}

/** Note-text escape: Mermaid `note for X "..."` blocks the inner
 *  string at the first unescaped quote. File paths don't normally
 *  contain quotes but we strip them defensively, and replace any
 *  other Mermaid-significant chars with safe substitutes. */
function escapeNoteText(s: string): string {
  return s.replace(/"/g, "'");
}

function anyExternalRefs(
  classes: ClassDef[],
  rendered: Set<string>
): boolean {
  for (const c of classes) {
    if (c.parentClass && !rendered.has(c.parentClass)) return true;
    for (const iface of c.implements ?? []) {
      if (!rendered.has(iface)) return true;
    }
  }
  return false;
}
