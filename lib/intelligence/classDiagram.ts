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
  FunctionDef,
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
  //
  // `direction TB` (top-to-bottom): nudges Mermaid towards a
  // vertical layout. classDiagram's renderer often ignores it but
  // it's a no-op when ignored, so we always emit.
  const lines: string[] = ["classDiagram", "  direction TB"];
  const renderedNames = new Set(trimmed.map((c) => c.name));

  // v0.71: namespace grouping by directory. Without this, Mermaid
  // sees 20+ flat class boxes with cross-cutting edges and lays
  // them out as one wide horizontal band — the failure mode that
  // made the 27-class diagram unreadable. Wrapping classes by
  // their folder gives Mermaid clusters to lay out, producing a
  // grid-like result instead. Only wraps when there's actual
  // structure (>=2 distinct folders) — single-folder diagrams
  // skip namespaces and render flat.
  const groups = groupByNamespace(trimmed);
  if (groups.length >= 2) {
    for (const group of groups) {
      lines.push(`  namespace ${group.name} {`);
      // Class blocks inside a namespace get extra indentation —
      // helps source readability when pasting into mermaid.live.
      for (const cls of group.classes) {
        for (const line of renderClassInsideNamespace(cls)) {
          lines.push(`  ${line}`);
        }
      }
      lines.push(`  }`);
    }
    // v0.71: file-path notes intentionally NOT emitted. They visually
    // outweighed the class names in 27-class diagrams, fragmenting the
    // layout with dotted-line annotation boxes. File paths are still
    // available in the Code tab for navigation. (When we ship the
    // ReactFlow-based class canvas in v0.72, file path will be a
    // hover/click affordance instead of an always-visible note.)
  } else {
    for (const cls of trimmed) {
      lines.push(...renderClassBlock(cls));
    }
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

  // v0.71: field-based association arrows. For each field whose
  // type matches a rendered class (Spring DI's `private final
  // FooService fooService` is the textbook example), emit
  // `Owner --> FieldType : fieldName`. Surfaces the dependency
  // graph that was previously hidden — readers could see the
  // FIELDS but had no visual cue that LoginController depends
  // on LogInService.
  //
  // Edge-case handling:
  //   - Try the bare field type first, then the EXTRACTED ELEMENT
  //     type for collection-shaped fields (`List<Card>` → Card,
  //     `[]Card` → Card, `Foo?` → Foo). Without this, `private
  //     List<Card> cards` in Collection wouldn't draw an arrow to
  //     Card — losing the most semantically important relation in
  //     entity models.
  //   - For duplicate-name classes that got `_basename` suffixes,
  //     the field type still carries the ORIGINAL name and won't
  //     match — we skip those rather than guessing which suffix
  //     to point at (ambiguous edges would mislead worse than
  //     no edge at all).
  //   - Skip self-references (Foo has Foo field — visual noise).
  //   - Skip when target isn't rendered. Mermaid would otherwise
  //     draw orphan boxes for stdlib types (List, Map, String).
  //   - Dedupe by (owner, target) so a class with N fields of
  //     the same type only emits one arrow.
  const seenAssoc = new Set<string>();
  for (const cls of trimmed) {
    for (const field of cls.fields) {
      if (!field.type) continue;
      const target = resolveArrowTarget(field.type, renderedNames);
      if (!target) continue;
      if (target === cls.name) continue;
      const key = `${cls.name}->${target}`;
      if (seenAssoc.has(key)) continue;
      seenAssoc.add(key);
      lines.push(`  ${cls.name} --> ${target} : ${field.name}`);
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

interface NamespaceGroup {
  /** Mermaid-safe identifier (no slashes / special chars). */
  name: string;
  /** Original folder path; kept around for sort stability. */
  folder: string;
  classes: ClassDef[];
}

/** Group classes by their containing folder so Mermaid can cluster them
 *  visually. Use the folder's leaf segment as the namespace label when
 *  it's unique across the diagram (`controller`, `service`, `entity`);
 *  fall back to the full path on collisions (e.g. multiple "service"
 *  folders under main/ and test/). Classes at the repo root land in a
 *  "root" group. */
function groupByNamespace(classes: ClassDef[]): NamespaceGroup[] {
  const byFolder = new Map<string, ClassDef[]>();
  for (const cls of classes) {
    const folder = posixDirname(cls.filePath);
    let arr = byFolder.get(folder);
    if (!arr) {
      arr = [];
      byFolder.set(folder, arr);
    }
    arr.push(cls);
  }

  // Tally leaf-segment occurrences so we know which leaves are unique.
  const leafCounts = new Map<string, number>();
  for (const folder of byFolder.keys()) {
    const leaf = leafOf(folder);
    leafCounts.set(leaf, (leafCounts.get(leaf) ?? 0) + 1);
  }

  const groups: NamespaceGroup[] = [];
  for (const [folder, group] of byFolder) {
    const leaf = leafOf(folder);
    const display =
      (leafCounts.get(leaf) ?? 0) > 1 ? folder.replace(/^\.?\/?/, "") : leaf;
    groups.push({
      name: sanitizeIdentifier(display) || "root",
      folder,
      classes: group,
    });
  }

  // Sort alphabetically by folder so the diagram source is deterministic
  // (otherwise insertion order leaks file-system traversal order into
  // the output, making git diffs noisy).
  groups.sort((a, b) => a.folder.localeCompare(b.folder));
  return groups;
}

/** Posix-style dirname that returns "root" for files at the top of the
 *  repo. Avoids node:path dependency in this isolated module. */
function posixDirname(filePath: string): string {
  const idx = filePath.lastIndexOf("/");
  return idx > 0 ? filePath.slice(0, idx) : "root";
}

function leafOf(folder: string): string {
  const idx = folder.lastIndexOf("/");
  return idx >= 0 ? folder.slice(idx + 1) : folder;
}

/** Render a class's body without the trailing `note for` line — notes
 *  inside namespace blocks are flaky across Mermaid renderer versions,
 *  so we hoist them to the top-level. */
function renderClassInsideNamespace(cls: ClassDef): string[] {
  const lines: string[] = [];
  const safeName = sanitizeIdentifier(cls.name);
  lines.push(`class ${safeName} {`);
  // Stereotype precedence: enum > interface > abstract. Enums in
  // Mermaid are tagged `<<enumeration>>` and list their values as
  // field-like entries. We don't apply visibility prefixes to enum
  // values — they're constants, not OOP members.
  if (cls.isEnum) {
    lines.push(`  <<enumeration>>`);
    for (const v of cls.enumValues ?? []) {
      lines.push(`  ${v}`);
    }
  } else if (cls.isInterface) {
    lines.push(`  <<interface>>`);
  } else if (cls.isAbstract) {
    lines.push(`  <<abstract>>`);
  }
  if (!cls.isEnum) {
    for (const f of cls.fields) {
      lines.push(`  ${renderField(f)}`);
    }
    for (const m of cls.methods) {
      lines.push(`  ${renderMethod(m)}`);
    }
  }
  lines.push(`}`);
  return lines;
}

function renderClassBlock(cls: ClassDef): string[] {
  const lines: string[] = [];
  const safeName = sanitizeIdentifier(cls.name);

  // Mermaid stereotype lines tag the class as `<<interface>>`,
  // `<<abstract>>`, or `<<enumeration>>`; they appear inside the
  // class body. Enum values render as plain identifiers (no
  // visibility prefix — they're constants).
  lines.push(`  class ${safeName} {`);
  if (cls.isEnum) {
    lines.push(`    <<enumeration>>`);
    for (const v of cls.enumValues ?? []) {
      lines.push(`    ${v}`);
    }
  } else if (cls.isInterface) {
    lines.push(`    <<interface>>`);
  } else if (cls.isAbstract) {
    lines.push(`    <<abstract>>`);
  }

  if (!cls.isEnum) {
    for (const field of cls.fields) {
      lines.push(`    ${renderField(field)}`);
    }
    for (const m of cls.methods) {
      lines.push(`    ${renderMethod(m)}`);
    }
  }

  lines.push(`  }`);

  // v0.71: file-path notes intentionally NOT emitted. They visually
  // outweighed the class names in 27-class diagrams, fragmenting the
  // layout with dotted-line annotation boxes. File paths remain
  // available in the Code tab for navigation. (When the ReactFlow-
  // based class canvas ships in v0.72, file path becomes a hover/
  // click affordance instead of an always-visible note.)

  return lines;
}

/** v0.71: render a method as `+name()` for the diagram. We don't carry
 *  per-method visibility on FunctionDef yet — tree-sitter modifier
 *  walking happens on fields but not methods — so we default to `+`
 *  (public). That's a fair default since most methods rendered are
 *  the "exposed surface" of a class. Constructors render with `+name()`
 *  too rather than special-casing — keeps the source readable.
 *  Parameter / return types are left out: we don't currently extract
 *  them into FunctionDef, and emitting `+login()` for a real
 *  `login(password: String): Token` would mislead more than it helps. */
function renderMethod(m: FunctionDef): string {
  return `+${m.name}()`;
}

function renderField(field: ParsedField): string {
  const vis = visToMermaid(field.visibility);
  // `$` after a member is Mermaid's official static marker. We
  // prefix it (after the visibility glyph) so it reads as a
  // modifier on the field name itself.
  const staticTag = field.isStatic ? "$" : "";
  // Mermaid's classDiagram syntax has no official "readonly" /
  // "final" marker. We tried `*` but it has no semantic meaning at
  // field-level (Mermaid only treats `*` as the abstract-method
  // tag) and rendered as part of the field name. Skipping
  // readonly for now — if we revisit, a `«readonly»` stereotype
  // line is the cleaner Mermaid-native option.
  const typeStr = field.type ? ` ${escapeAngleBrackets(field.type)}` : "";
  return `${vis}${staticTag}${field.name}${typeStr}`;
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

/** Mermaid identifiers can't contain ., <, >, /, or other special
 *  chars. Class names usually don't, but generic types might appear
 *  in the parser's output (e.g. `Map<K,V>`), and namespace
 *  identifiers built from folder paths contain slashes when the
 *  collision-fallback kicks in. Strip them defensively so the
 *  diagram still parses. */
function sanitizeIdentifier(name: string): string {
  return name.replace(/[<>,./ \t]/g, "_");
}

/** Mermaid uses < and > as part of its syntax (stereotypes,
 *  arrows). When a type contains them — `Map<K,V>` — they have to
 *  be escaped or Mermaid mis-parses the line. We replace with
 *  HTML-style entities; Mermaid renders those as the literal
 *  characters in the final output. */
function escapeAngleBrackets(s: string): string {
  return s.replace(/</g, "~").replace(/>/g, "~");
}

/** v0.71: pick the right rendered class to point an association arrow
 *  at, given a field's display type. Tries the bare type first; if
 *  unmatched, peels off common collection / pointer / nullable
 *  wrappers to find an inner type that IS rendered. Returns undefined
 *  when nothing resolves — caller skips the arrow.
 *
 *  Patterns handled (covers Java, C#, PHP, Go, TS):
 *    - `List<Card>` / `Map<K, V>` → tries each comma-separated arg
 *    - `[]Card` (Go slice) → tries `Card`
 *    - `*Foo` (Go pointer) → tries `Foo`
 *    - `Foo?` (PHP / TS / C# nullable) → tries `Foo`
 *    - `map[string]User` (Go map) → tries `User` (ignores the key)
 */
function resolveArrowTarget(
  type: string,
  rendered: Set<string>
): string | undefined {
  // Direct hit — most common case.
  if (rendered.has(type)) return type;
  // Strip nullable suffix.
  if (type.endsWith("?")) {
    const inner = type.slice(0, -1).trim();
    if (rendered.has(inner)) return inner;
  }
  // Generic angle brackets (Java/C#/TS).
  const angleMatch = type.match(/^[A-Za-z_][A-Za-z0-9_.]*<(.+)>$/);
  if (angleMatch) {
    for (const candidate of splitTopLevel(angleMatch[1])) {
      const t = resolveArrowTarget(candidate.trim(), rendered);
      if (t) return t;
    }
  }
  // Generic square brackets (Go).
  const bracketMatch = type.match(/^[A-Za-z_][A-Za-z0-9_.]*\[(.+)\]$/);
  if (bracketMatch) {
    for (const candidate of splitTopLevel(bracketMatch[1])) {
      const t = resolveArrowTarget(candidate.trim(), rendered);
      if (t) return t;
    }
  }
  // Go slice prefix.
  if (type.startsWith("[]")) {
    return resolveArrowTarget(type.slice(2).trim(), rendered);
  }
  // Go pointer prefix.
  if (type.startsWith("*")) {
    return resolveArrowTarget(type.slice(1).trim(), rendered);
  }
  // Go map: `map[K]V` — recurse on the value half.
  const mapMatch = type.match(/^map\[(.+)\](.+)$/);
  if (mapMatch) {
    const valueType = mapMatch[2].trim();
    return resolveArrowTarget(valueType, rendered);
  }
  return undefined;
}

/** Split a generic argument list on top-level commas only — naively
 *  splitting `Map<K, V>, List<X>` on every `,` would produce four
 *  fragments. Tracks bracket depth to keep nested generics intact. */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "<" || c === "[") depth++;
    else if (c === ">" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
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
