// C# plugin — fourth migration off the regex-fallback (v0.21).
//
// Same shape as the Java plugin (Phase 5 type-aware via parseDirect): tracks
// field/property/parameter/local types in scope, infers calleeType for
// `obj.method()` calls. C#'s namespace + class system maps neatly onto
// Java's package + class FQN model — the indexing strategy is identical,
// just with C# node names.
//
// Differences from java.ts worth noting:
//   1. Calls go through invocation_expression with a `function` field. The
//      function can be an `identifier` (bare call) or a
//      `member_access_expression` (obj.method() / this.method()). Java's
//      method_invocation exposes name + object directly; C# wraps the
//      receiver inside member_access_expression.
//   2. Properties (`property_declaration`) are tracked alongside fields. C#
//      idiomatically uses properties for state, and `public Foo MyField`
//      is rare — skipping properties would lose most type info.
//   3. C# allows multiple namespace declarations per file plus file-scoped
//      `namespace X.Y;`. The FQN-builder takes the FIRST namespace it sees
//      via regex (covers 95% of real-world files). Nested namespaces +
//      multi-namespace files lose some precision; acceptable for v1.
//   4. `var` keyword + `new Foo()` initializer triggers type inference for
//      locals (analog to JS plugin's untyped-const-with-new pattern).
//   5. Generic types: `List<Foo>` is `generic_name` in C# (Java calls it
//      `generic_type`). Stripping returns the base type for FQN lookup —
//      same convention as Java.

import path from "node:path";
import { Parser } from "web-tree-sitter";
import type { Language, Node as TsNode } from "web-tree-sitter";
import type {
  ClassMemberVisibility,
  CodeAnalysisPlugin,
  FileIndex,
  ParsedCall,
  ParsedClass,
  ParsedField,
  ParsedFile,
  ParsedFunction,
  ParsedImport,
  PluginQueries,
  SourceFile,
} from "../types";
import { loadBuiltinGrammar } from "../runtime";
import { hashSubtree } from "../astHash";

const PLUGIN_NAME = "csharp";
const EXTENSIONS = ["cs"] as const;

let lang: Language | null = null;

// ------------------- Module-level resolver context -------------------

interface CSharpResolverContext {
  /** FQN ("App.Services.UserService") → repo-rel path. Built from namespace
   *  declarations + class names found via regex in prepareForRepo. */
  fqnToPath: Map<string, string>;
  /** Namespace ("App.Services") → repo-rel paths in that namespace. Used to
   *  resolve wildcard `using App.Services;` imports (where the spec is just
   *  the namespace name and we need to map it to *some* file in that
   *  namespace). */
  namespaceMembers: Map<string, string[]>;
}

// First namespace declaration in the file. Handles both block form
// (`namespace X.Y { ... }`) and file-scoped form (`namespace X.Y;`).
// Multi-namespace files lose precision — we only index types in the first
// namespace. Acceptable trade-off; rare in practice.
const NAMESPACE_RE = /^\s*namespace\s+([A-Za-z_][A-Za-z0-9_.]*)\s*[;{]/m;

// Top-level class/interface/struct/record/enum names. Conservative: only
// matches declarations at column 0 or with leading whitespace (typical
// nesting). Multi-line modifier chains (`public sealed class`) are handled
// via the optional non-capturing modifier prefix.
const TYPE_DECL_RE =
  /(?:^|\n)\s*(?:(?:public|internal|private|protected|abstract|sealed|static|partial|new|unsafe|readonly|ref|virtual|override)\s+)*(?:class|interface|struct|record|enum)\s+([A-Z][A-Za-z0-9_]*)/g;

// ------------------- Index construction -------------------

function buildCSharpContext(ix: FileIndex): CSharpResolverContext {
  const fqnToPath = new Map<string, string>();
  const namespaceMembers = new Map<string, string[]>();

  for (const f of ix.byPath.values()) {
    if (f.ext !== "cs") continue;
    const head = f.content.slice(0, 8192);
    const nsMatch = NAMESPACE_RE.exec(head);
    const ns = nsMatch?.[1] ?? null;
    // Reset regex state — TYPE_DECL_RE is global and stateful
    TYPE_DECL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TYPE_DECL_RE.exec(f.content)) !== null) {
      const typeName = m[1];
      const fqn = ns ? `${ns}.${typeName}` : typeName;
      // First-write-wins: if the same FQN appears twice, keep the first file
      // (rare — typically partial classes split across files; we treat one
      // representative file as canonical for resolution).
      if (!fqnToPath.has(fqn)) fqnToPath.set(fqn, f.rel);
      // Also index bare class name for default-namespace files
      if (!ns && !fqnToPath.has(typeName)) fqnToPath.set(typeName, f.rel);
      if (ns) {
        let members = namespaceMembers.get(ns);
        if (!members) {
          members = [];
          namespaceMembers.set(ns, members);
        }
        if (!members.includes(f.rel)) members.push(f.rel);
      }
    }
    TYPE_DECL_RE.lastIndex = 0;
    // Defensive fallback: if a file has a namespace but no detectable type
    // declaration (rare — empty file, file with only `using`s), still tie it
    // to the namespace so namespaceMembers stays meaningful.
    if (ns && !path.posix.basename(f.rel).startsWith("Assembly")) {
      let members = namespaceMembers.get(ns);
      if (!members) {
        members = [];
        namespaceMembers.set(ns, members);
      }
      if (!members.includes(f.rel)) members.push(f.rel);
    }
  }

  for (const arr of namespaceMembers.values()) arr.sort();

  return { fqnToPath, namespaceMembers };
}

// ------------------- Import resolution -------------------

function resolveCSharpImport(
  spec: string,
  _fromPath: string,
  ix: FileIndex
): string | null {
  const ctx = ix.extras.get(PLUGIN_NAME) as CSharpResolverContext | undefined;
  if (!ctx) return null;
  // `using X.Y.SomeType;` direct match
  const direct = ctx.fqnToPath.get(spec);
  if (direct) return direct;
  // `using X.Y;` namespace-only match (no wildcard syntax in C#, but plain
  // `using <namespace>` is the equivalent)
  const members = ctx.namespaceMembers.get(spec);
  if (members && members.length > 0) return members[0];
  return null;
}

// ------------------- Tree-sitter queries (kept for reference) -------------------

const QUERIES: PluginQueries = {
  imports: `(using_directive (identifier) @spec)
            (using_directive (qualified_name) @spec)`,
  functionDefs: `
    (method_declaration name: (identifier) @name body: (block) @body)
    (constructor_declaration name: (identifier) @name body: (block) @body)
  `,
  callSites: `
    (invocation_expression function: (identifier) @callee)
    (invocation_expression function: (member_access_expression name: (identifier) @callee))
    (object_creation_expression type: (identifier) @callee)
  `,
  decisionPoints: `
    (if_statement) @p
    (while_statement) @p
    (for_statement) @p
    (for_each_statement) @p
    (do_statement) @p
    (catch_clause) @p
    (conditional_expression) @p
    (switch_section) @p
    (binary_expression operator: "&&") @p
    (binary_expression operator: "||") @p
  `,
};

// ------------------- Type extraction -------------------

/** Extract a type name (bare class name) from a C# type AST node. Returns
 *  null for primitives, arrays, tuples, and types we can't statically
 *  resolve. Generics are stripped to their base type — our type index is
 *  keyed by class name, not parameterized type. */
function extractTypeName(node: TsNode): string | null {
  switch (node.type) {
    case "identifier":
      return node.text;
    case "predefined_type":
      // int, string, bool, void — no class in our index
      return null;
    case "qualified_name": {
      // "System.Collections.List" → "List" (last segment). Type-tracking
      // against qualified names is rare in practice and the bare class name
      // matches our FQN→path index just as well via the namespaceMembers
      // pathway.
      const parts = node.text.split(".");
      return parts[parts.length - 1] ?? null;
    }
    case "generic_name": {
      // generic_name's named children are the base type (identifier) +
      // type_argument_list. Take the identifier.
      for (const child of node.namedChildren) {
        if (child.type === "identifier") return child.text;
      }
      return null;
    }
    case "nullable_type": {
      // Foo? — recurse on the inner type
      const inner = node.namedChildren[0];
      return inner ? extractTypeName(inner) : null;
    }
    // array_type, tuple_type, pointer_type → null (no class to look up)
    default:
      return null;
  }
}

/** Walk a class/struct/record body for fields + properties, return name→type
 *  map. C# uses property_declaration alongside field_declaration for state,
 *  and idiomatically prefers properties — both must be tracked. */
function collectMemberTypes(classBody: TsNode): Map<string, string> {
  const out = new Map<string, string>();

  for (const child of classBody.namedChildren) {
    if (child.type === "field_declaration") {
      // field_declaration wraps variable_declaration which has a `type` field
      // and one or more variable_declarator children.
      const vd = child.namedChildren.find((c) => c.type === "variable_declaration");
      if (!vd) continue;
      const typeNode = vd.childForFieldName("type");
      if (!typeNode) continue;
      const typeName = extractTypeName(typeNode);
      if (!typeName) continue;
      for (const sub of vd.namedChildren) {
        if (sub.type !== "variable_declarator") continue;
        // variable_declarator's first named child is typically the name
        const nameNode = sub.namedChildren[0];
        if (nameNode?.type === "identifier") out.set(nameNode.text, typeName);
      }
    } else if (child.type === "property_declaration") {
      // property_declaration has explicit `name` + `type` fields
      const typeNode = child.childForFieldName("type");
      const nameNode = child.childForFieldName("name");
      if (!typeNode || !nameNode) continue;
      const typeName = extractTypeName(typeNode);
      if (typeName) out.set(nameNode.text, typeName);
    }
  }

  return out;
}

/** v0.71: full field metadata for the Architecture-tab Mermaid
 *  generator. C# modifiers — `public`/`private`/`protected`/
 *  `internal`/`static`/`readonly`/`const` — are wrapped in NAMED
 *  `modifier` nodes (each with an anonymous keyword child). Walk
 *  the field_declaration's namedChildren for `modifier` nodes,
 *  then read the inner keyword via .child(0).type. Different from
 *  Java where modifiers are anonymous-direct-children of a
 *  `modifiers` wrapper. */
function collectModifiersFromNode(
  node: TsNode
): { visibility: ClassMemberVisibility; isStatic: boolean; isReadonly: boolean; isAbstract: boolean } {
  let visibility: ClassMemberVisibility = "private"; // C# default for class members
  let isStatic = false;
  let isReadonly = false;
  let isAbstract = false;
  for (const c of node.namedChildren) {
    if (c.type !== "modifier") continue;
    // The keyword is the first (typically only) child of the modifier wrapper
    const kw = c.child(0);
    if (!kw) continue;
    const t = kw.type;
    if (t === "public") visibility = "public";
    else if (t === "private") visibility = "private";
    else if (t === "protected") visibility = "protected";
    else if (t === "internal") visibility = "internal";
    else if (t === "static") isStatic = true;
    else if (t === "readonly" || t === "const") isReadonly = true;
    else if (t === "abstract") isAbstract = true;
  }
  return { visibility, isStatic, isReadonly, isAbstract };
}

/** v0.71: type extraction for FIELD DISPLAY purposes (Architecture
 *  tab). Same rationale as the Java helper — type-tracking wants the
 *  base name, but the diagram preserves "List<Card>" so the consumer
 *  can pull element types for composition arrows. C# spelling note:
 *  generic types are `generic_name` (Java's grammar calls them
 *  `generic_type`), and the inner shape is identifier + type_argument_list. */
function extractFieldType(node: TsNode): string | undefined {
  const base = extractTypeName(node);
  if (!base) return undefined;
  if (node.type === "nullable_type") {
    // Recurse on the inner type, append `?` for the diagram so users
    // see `Validator?` rather than just `Validator`.
    const inner = node.namedChildren[0];
    const innerName = inner ? extractFieldType(inner) : undefined;
    return innerName ? `${innerName}?` : base;
  }
  if (node.type !== "generic_name") return base;
  const args: string[] = [];
  for (const child of node.namedChildren) {
    if (child.type !== "type_argument_list") continue;
    for (const arg of child.namedChildren) {
      const inner = extractFieldType(arg);
      if (inner) args.push(inner);
    }
  }
  if (args.length === 0) return base;
  return `${base}<${args.join(", ")}>`;
}

function collectFullClassFields(classBody: TsNode): ParsedField[] {
  const out: ParsedField[] = [];

  for (const child of classBody.namedChildren) {
    if (child.type !== "field_declaration" && child.type !== "property_declaration") {
      continue;
    }

    const { visibility, isStatic, isReadonly } = collectModifiersFromNode(child);

    if (child.type === "field_declaration") {
      const vd = child.namedChildren.find((c) => c.type === "variable_declaration");
      if (!vd) continue;
      const typeNode = vd.childForFieldName("type");
      const type = typeNode ? extractFieldType(typeNode) : undefined;
      for (const sub of vd.namedChildren) {
        if (sub.type !== "variable_declarator") continue;
        const nameNode = sub.namedChildren[0];
        if (nameNode?.type === "identifier") {
          out.push({
            name: nameNode.text,
            type,
            visibility,
            isStatic,
            isReadonly,
          });
        }
      }
    } else if (child.type === "property_declaration") {
      const typeNode = child.childForFieldName("type");
      const nameNode = child.childForFieldName("name");
      if (!nameNode) continue;
      const type = typeNode ? extractFieldType(typeNode) : undefined;
      out.push({
        name: nameNode.text,
        type,
        visibility,
        isStatic,
        isReadonly,
      });
    }
  }
  return out;
}

/** Extract the parent class / first listed base type from a C#
 *  class_declaration's base_list. C# uses `: BaseClass, IFace1,
 *  IFace2` syntax — the first entry MAY be a class or an interface;
 *  we follow the convention that the first non-interface-named
 *  entry is the parent. We don't have interface metadata at parse
 *  time, so we treat all base_list entries as "parents + interfaces"
 *  and let the cross-snapshot consumer decide. v1: pick the first
 *  as parentClass, the rest as implements. */
function extractCsharpBases(classNode: TsNode): {
  parentClass?: string;
  implements: string[];
} {
  const baseList = classNode.namedChildren.find(
    (c): c is TsNode => !!c && c.type === "base_list"
  );
  if (!baseList) return { implements: [] };
  const bases: string[] = [];
  for (const child of baseList.namedChildren) {
    if (child.type === "identifier") bases.push(child.text);
    else if (child.type === "qualified_name") bases.push(child.text);
    else if (child.type === "generic_name") {
      const inner = child.childForFieldName("name");
      if (inner) bases.push(inner.text);
      else bases.push(child.text.split("<")[0]);
    }
  }
  if (bases.length === 0) return { implements: [] };
  return { parentClass: bases[0], implements: bases.slice(1) };
}

/** True when the class declares the `abstract` modifier. C# wraps each
 *  class-level modifier in a named `modifier` node — same shape as the
 *  field/property modifier handling above. */
function isAbstractCsharpClass(classNode: TsNode): boolean {
  return collectModifiersFromNode(classNode).isAbstract;
}

/** v0.71: walk a C# enum_declaration's enum_member_declaration_list
 *  for the constant names (`Active`, `Inactive`, `Pending`). C#
 *  exposes the body as `enum_member_declaration_list`, not under a
 *  `body` field name — so we find it via type lookup. */
function collectCsharpEnumValues(enumNode: TsNode): string[] {
  const list = enumNode.namedChildren.find(
    (c) => c.type === "enum_member_declaration_list"
  );
  if (!list) return [];
  const out: string[] = [];
  for (const child of list.namedChildren) {
    if (child.type !== "enum_member_declaration") continue;
    const idNode = child.namedChildren.find((c) => c.type === "identifier");
    if (idNode?.text) out.push(idNode.text);
  }
  return out;
}

/** Walk a method's parameter_list, return name→type map. */
function collectParamTypes(methodNode: TsNode): Map<string, string> {
  const out = new Map<string, string>();
  const params = methodNode.childForFieldName("parameters");
  if (!params) return out;
  for (const p of params.namedChildren) {
    if (p.type !== "parameter") continue;
    const typeNode = p.childForFieldName("type");
    const nameNode = p.childForFieldName("name");
    if (!typeNode || !nameNode) continue;
    const typeName = extractTypeName(typeNode);
    if (typeName) out.set(nameNode.text, typeName);
  }
  return out;
}

/** Try to infer the type of a `var` initializer. Specifically catches the
 *  `var x = new Foo()` pattern, which is the only form where we can be
 *  confident about the type without full inference. */
function inferInitializerType(initNode: TsNode | null): string | null {
  if (!initNode) return null;
  if (initNode.type !== "object_creation_expression") return null;
  const typeNode = initNode.childForFieldName("type");
  return typeNode ? extractTypeName(typeNode) : null;
}

// ------------------- parseDirect: AST walk with type tracking -------------------

interface MethodScope {
  name: string;
  locals: Map<string, string>;
  decisionPoints: number;
}

interface ClassScope {
  name: string;
  fields: Map<string, string>;
}

function parseCSharpDirect(file: SourceFile, _ix: FileIndex): ParsedFile {
  if (!lang) {
    throw new Error("csharp plugin not loaded — call plugin.load() first");
  }
  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(file.content);
  if (!tree) {
    parser.delete();
    return errorParsedFile(file);
  }

  const imports: ParsedImport[] = [];
  const functions: ParsedFunction[] = [];
  const calls: ParsedCall[] = [];
  /** v0.71: full ParsedClass entries for the Architecture-tab Mermaid
   *  generator. Captured alongside the existing classStack entries
   *  (which only carry name + member types for type-aware call
   *  resolution). Only class_declaration + interface_declaration types
   *  emit entries — structs/records/enums get a separate visualisation
   *  in a later phase. */
  const parsedClasses: ParsedClass[] = [];
  let totalDecisionPoints = 0;

  const seenImportSpecs = new Set<string>();
  const classStack: ClassScope[] = [];
  const methodStack: MethodScope[] = [];

  function currentClass(): ClassScope | null {
    return classStack[classStack.length - 1] ?? null;
  }
  function currentMethod(): MethodScope | null {
    return methodStack[methodStack.length - 1] ?? null;
  }

  function lookupVariableType(name: string): string | null {
    for (let i = methodStack.length - 1; i >= 0; i--) {
      const t = methodStack[i].locals.get(name);
      if (t) return t;
    }
    const cls = currentClass();
    if (cls) {
      const t = cls.fields.get(name);
      if (t) return t;
    }
    return null;
  }

  function countDecisionPoint() {
    totalDecisionPoints++;
    const m = currentMethod();
    if (m) m.decisionPoints++;
  }

  /** Resolve calleeType from the receiver of a `obj.method()` call. The
   *  receiver comes in as the `expression` field of a member_access_expression.
   *  Bare calls (no receiver) get implicit `this` = current class. */
  function resolveCalleeType(receiver: TsNode | null): string | undefined {
    const cls = currentClass();
    if (!receiver) return cls?.name ?? undefined;
    switch (receiver.type) {
      case "this":
        return cls?.name ?? undefined;
      case "base":
        // No inheritance edges tracked yet — let pickCallTarget fall back to
        // name-match
        return undefined;
      case "identifier": {
        const t = lookupVariableType(receiver.text);
        if (t) return t;
        // Bare identifier could also be a class name (static call). Pass it
        // through; the candidate disambiguator will try.
        return receiver.text;
      }
      case "member_access_expression": {
        // `this.field.method()` — field on current class
        const innerExpr = receiver.childForFieldName("expression");
        const memberName = receiver.childForFieldName("name")?.text;
        if (!memberName) return undefined;
        if (innerExpr?.type === "this") {
          return cls?.fields.get(memberName);
        }
        return undefined;
      }
      case "cast_expression": {
        // tree-sitter-c-sharp parses `(T)x?.y()` as `((T)x)?.y()`, which is
        // at odds with C# precedence (where `(T)expr.method()` actually means
        // `(T)(expr.method())`). We treat the cast target as the receiver
        // type — works correctly for legitimate `((T)x).method()` patterns
        // and is also good enough for the precedence-mismatch case: if T is
        // external (like ICustomFormatter), pickCallTarget's strict
        // type-aware path turns the call into an unresolved edge, which is
        // the safe outcome. (Discovered during v0.21 serilog validation: a
        // `(ICustomFormatter?)formatProvider?.GetFormat(...)` was resolving
        // to a test method because cast_expression went undefined.)
        const typeChild = receiver.namedChildren[0];
        if (typeChild) {
          const castType = extractTypeName(typeChild);
          if (castType) return castType;
        }
        // Fall back to the inner expression's type when the cast target is a
        // primitive (e.g., `(int)x`) or otherwise unextractable.
        const innerExpr = receiver.namedChildren[1];
        if (innerExpr) return resolveCalleeType(innerExpr);
        return undefined;
      }
      case "parenthesized_expression": {
        // `(expr).method()` — the parens are syntactic, recurse on the
        // wrapped expression.
        const inner = receiver.namedChildren[0];
        return inner ? resolveCalleeType(inner) : undefined;
      }
      // invocation_expression (chained calls), etc. — would need return-type
      // tracking. Skip in v1.
      default:
        return undefined;
    }
  }

  function visit(node: TsNode) {
    switch (node.type) {
      case "using_directive": {
        // Single named child: identifier ("System") or qualified_name
        // ("System.Collections.Generic"). `using static` and `using Alias = ...`
        // also pass through this type — they show up with extra modifier
        // children that we ignore for spec extraction.
        let spec: string | null = null;
        for (const child of node.namedChildren) {
          if (child.type === "identifier" || child.type === "qualified_name") {
            spec = child.text;
            break;
          }
        }
        if (spec && !seenImportSpecs.has(spec)) {
          seenImportSpecs.add(spec);
          imports.push({
            rawSpec: spec,
            resolvedPath: resolveCSharpImport(spec, file.rel, _ix),
          });
        }
        return;
      }

      case "class_declaration":
      case "interface_declaration":
      case "struct_declaration":
      case "record_declaration":
      case "enum_declaration": {
        const nameNode = node.childForFieldName("name");
        const className = nameNode?.text ?? "<anon>";
        const bodyNode = node.childForFieldName("body");
        const fields = bodyNode
          ? collectMemberTypes(bodyNode)
          : new Map<string, string>();
        classStack.push({ name: className, fields });

        // Collect method names from the body BEFORE we recurse — needed
        // to populate ParsedClass.methodNames so the codeGraph aggregator
        // can match them to FunctionDef entries by (containerType, name).
        const methodNames: string[] = [];
        if (bodyNode) {
          for (const member of bodyNode.namedChildren) {
            if (
              member.type !== "method_declaration" &&
              member.type !== "constructor_declaration"
            ) {
              continue;
            }
            const m = member.childForFieldName("name");
            if (m && m.text) methodNames.push(m.text);
          }
        }

        if (bodyNode) {
          for (const child of bodyNode.namedChildren) visit(child);
        }
        // Records can have a primary constructor inline (no body):
        // `public record Foo(int Bar);` — we don't extract those parameters
        // as fields in v1. The class scope still pushes/pops correctly.
        classStack.pop();

        // v0.71: emit ParsedClass for the Architecture tab. Anonymous
        // classes are skipped. struct/record diagrams remain a later
        // phase. Enums get a dedicated branch since their body is an
        // enum_member_declaration_list (not a `body` field) and they
        // carry value names instead of fields.
        if (
          className !== "<anon>" &&
          (node.type === "class_declaration" ||
            node.type === "interface_declaration") &&
          bodyNode
        ) {
          const bases = extractCsharpBases(node);
          parsedClasses.push({
            name: className,
            startRow: node.startPosition.row,
            endRow: node.endPosition.row,
            fields: collectFullClassFields(bodyNode),
            methodNames,
            parentClass: bases.parentClass,
            implements: bases.implements,
            isInterface: node.type === "interface_declaration",
            isAbstract: isAbstractCsharpClass(node),
          });
        } else if (
          className !== "<anon>" &&
          node.type === "enum_declaration"
        ) {
          parsedClasses.push({
            name: className,
            startRow: node.startPosition.row,
            endRow: node.endPosition.row,
            fields: [],
            methodNames: [],
            isEnum: true,
            enumValues: collectCsharpEnumValues(node),
          });
        }
        return;
      }

      case "method_declaration":
      case "constructor_declaration":
      case "local_function_statement": {
        const nameNode = node.childForFieldName("name");
        const fnName = nameNode?.text ?? "<anon>";
        const startRow = node.startPosition.row;
        const endRow = node.endPosition.row;
        const params = collectParamTypes(node);
        const locals = new Map(params);
        methodStack.push({ name: fnName, locals, decisionPoints: 0 });
        const body = node.childForFieldName("body");
        if (body) {
          for (const child of body.namedChildren) visit(child);
        }
        const ms = methodStack.pop()!;
        functions.push({
          name: fnName,
          startRow,
          endRow,
          complexity: 1 + ms.decisionPoints,
          containerType: currentClass()?.name,
          bodyHash: body ? hashSubtree(body) : undefined,
        });
        return;
      }

      case "local_declaration_statement": {
        // local_declaration_statement wraps a single variable_declaration with
        // a type field + variable_declarator children.
        const vd = node.namedChildren.find(
          (c) => c.type === "variable_declaration"
        );
        if (vd) {
          const typeNode = vd.childForFieldName("type");
          // If type is `var` (an identifier with text "var"), try
          // initializer-inference. Otherwise extract type directly.
          let typeName: string | null = null;
          if (
            typeNode &&
            !(typeNode.type === "identifier" && typeNode.text === "var")
          ) {
            typeName = extractTypeName(typeNode);
          }
          for (const sub of vd.namedChildren) {
            if (sub.type !== "variable_declarator") continue;
            const nameNode = sub.namedChildren[0];
            if (nameNode?.type !== "identifier") continue;
            // For typed locals, use the declared type
            if (typeName) {
              const m = currentMethod();
              if (m) m.locals.set(nameNode.text, typeName);
              continue;
            }
            // For `var` locals, try to infer from initializer. The
            // variable_declarator's last child is the initializer expression
            // (e.g., object_creation_expression).
            const initializer = sub.namedChildren[sub.namedChildren.length - 1];
            if (initializer && initializer !== nameNode) {
              const inferred = inferInitializerType(initializer);
              if (inferred) {
                const m = currentMethod();
                if (m) m.locals.set(nameNode.text, inferred);
              }
            }
          }
        }
        // Continue visiting — initializers may have nested calls/decisions
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "invocation_expression": {
        const fn = node.childForFieldName("function");
        if (fn) {
          let calleeName: string | null = null;
          let receiver: TsNode | null = null;
          if (fn.type === "identifier") {
            calleeName = fn.text;
            receiver = null;
          } else if (fn.type === "member_access_expression") {
            calleeName = fn.childForFieldName("name")?.text ?? null;
            receiver = fn.childForFieldName("expression");
          } else if (fn.type === "conditional_access_expression") {
            // `obj?.method()` — the conditional_access_expression's first
            // named child is the receiver; subsequent member_binding_expression
            // contains the method name. C# specific: regular member access
            // uses member_access_expression, the null-conditional `?.` uses
            // this dedicated node type.
            const children = fn.namedChildren;
            receiver = children[0] ?? null;
            const binding = children.find(
              (c) => c.type === "member_binding_expression"
            );
            if (binding) {
              for (const sub of binding.namedChildren) {
                if (sub.type === "identifier") {
                  calleeName = sub.text;
                  break;
                }
              }
            }
          } else if (fn.type === "generic_name") {
            // `Foo.Bar<int>()` — the generic_name itself is the callee. The
            // identifier inside is the bare method name.
            for (const child of fn.namedChildren) {
              if (child.type === "identifier") {
                calleeName = child.text;
                break;
              }
            }
          }
          if (calleeName) {
            calls.push({
              calleeName,
              inFunction: currentMethod()?.name ?? null,
              fromContainerType: currentClass()?.name,
              calleeType: resolveCalleeType(receiver),
              // An explicit receiver (obj.Method(), obj?.Method()) engages the
              // resolver's strict guard against false name-collision matches on
              // untyped receivers; a bare Method() keeps the old behavior.
              hasReceiver: !!receiver,
            });
          }
        }
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "object_creation_expression": {
        // `new Foo()` / `new Foo<T>()` — calleeName = the class itself
        const typeNode = node.childForFieldName("type");
        if (typeNode) {
          const typeName = extractTypeName(typeNode);
          if (typeName) {
            calls.push({
              calleeName: typeName,
              inFunction: currentMethod()?.name ?? null,
              fromContainerType: currentClass()?.name,
              calleeType: typeName,
              // Constructor call — resolve strictly by type; never fall back
              // to a top-level function that happens to share the class name.
              hasReceiver: true,
            });
          }
        }
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "if_statement":
      case "while_statement":
      case "for_statement":
      case "for_each_statement":
      case "do_statement":
      case "catch_clause":
      case "conditional_expression":
        countDecisionPoint();
        for (const child of node.namedChildren) visit(child);
        return;

      case "switch_section": {
        // C#-specific: a `case X:` clause is a `switch_section` whose first
        // statement is preceded by a pattern child (constant_pattern,
        // type_pattern, etc.). `default:` switch_sections start with a
        // statement directly. Use the source-text prefix as a robust
        // discriminator — same shape as the Java plugin's switch_label
        // handling.
        if (node.text.trimStart().startsWith("case")) countDecisionPoint();
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "binary_expression": {
        const op = node.childForFieldName("operator")?.text;
        if (op === "&&" || op === "||") countDecisionPoint();
        for (const child of node.namedChildren) visit(child);
        return;
      }

      default:
        for (const child of node.namedChildren) visit(child);
    }
  }

  visit(tree.rootNode);

  tree.delete();
  parser.delete();

  return {
    rel: file.rel,
    imports,
    functions,
    calls,
    fileComplexity: 1 + totalDecisionPoints,
    parseError: false,
    classes: parsedClasses,
  };
}

function errorParsedFile(file: SourceFile): ParsedFile {
  return {
    rel: file.rel,
    imports: [],
    functions: [],
    calls: [],
    fileComplexity: 1,
    parseError: true,
  };
}

// ------------------- Plugin -------------------

export const csharpPlugin = {
  name: PLUGIN_NAME,
  extensions: EXTENSIONS,

  async load() {
    if (lang) return;
    lang = await loadBuiltinGrammar("tree-sitter-c-sharp");
  },

  async prepareForRepo(_root: string, ix: FileIndex) {
    ix.extras.set(PLUGIN_NAME, buildCSharpContext(ix));
  },

  languageFor(_ext) {
    if (!lang) {
      throw new Error(
        `csharp plugin not loaded — call plugin.load() before languageFor()`
      );
    }
    return lang;
  },

  queriesFor(_ext): PluginQueries {
    return QUERIES;
  },

  parseDirect: parseCSharpDirect,

  resolveImport: resolveCSharpImport,
} satisfies CodeAnalysisPlugin;
