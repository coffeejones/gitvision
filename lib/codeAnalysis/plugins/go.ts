// Go plugin — second migration off the regex-fallback (v0.13), type-aware
// since v0.16.
//
// Mirrors plugins/java.ts's parseDirect approach: a manual AST walk that
// maintains a type-tracking scope stack, instead of pure tree-sitter queries.
// Why parseDirect for Go: methods are declared OUTSIDE their struct (`func
// (s *Service) M()` is sibling of `type Service struct {...}` in the AST),
// so we need to pre-collect struct field types in a first pass and then
// look them up while walking method bodies.
//
// What v0.16 tracks:
//   - Method receivers   `func (s *Service) M()` → s : Service
//   - Function/method params with explicit types
//   - `var x SomeType` declarations
//   - Struct field types from `type Service struct { client *Client }`
//   - `s := SomeType{...}` composite literals (only — `s := f()` requires
//     return-type inference which is out of scope for v1)
//
// What it doesn't track in v1:
//   - Type inference from arbitrary `:=` expressions (return types of calls)
//   - Interface dispatch (Go's interfaces are duck-typed)
//   - Embedded struct fields
//   - Generic type instantiation tracking

import { promises as fs } from "node:fs";
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

const PLUGIN_NAME = "go";
const EXTENSIONS = ["go"] as const;

let lang: Language | null = null;

interface GoResolverContext {
  /** The repo's local module path from go.mod, e.g. "github.com/owner/repo".
   *  null if go.mod is absent or doesn't declare a module. */
  modulePath: string | null;
}

// ------------------- Tree-sitter queries (kept for contract) -------------------

const QUERIES: PluginQueries = {
  imports: `(import_spec path: (interpreted_string_literal) @spec)`,
  functionDefs: `
    (function_declaration name: (identifier) @name body: (block) @body)
    (method_declaration name: (field_identifier) @name body: (block) @body)
  `,
  callSites: `
    (call_expression function: (identifier) @callee)
    (call_expression function: (selector_expression field: (field_identifier) @callee))
  `,
  decisionPoints: `
    (if_statement) @p
    (for_statement) @p
    (expression_case) @p
    (type_case) @p
    (communication_case) @p
    (binary_expression operator: "&&") @p
    (binary_expression operator: "||") @p
  `,
};

// ------------------- Type extraction -------------------

const STRING_QUOTES_RE = /^["`]|["`]$/g;

/** Strip Go's type wrappers and return the bare class/struct name we use as
 *  a type-table key. Returns null for types we can't statically resolve to a
 *  named struct (slices, maps, channels, function types, interface types). */
function extractTypeName(node: TsNode): string | null {
  switch (node.type) {
    case "type_identifier":
      return node.text;
    case "pointer_type": {
      // *Service → Service
      for (const child of node.namedChildren) {
        const t = extractTypeName(child);
        if (t) return t;
      }
      return null;
    }
    case "qualified_type": {
      // pkg.Service → Service (last segment). External-package types won't
      // match our in-repo struct table, but we still surface the bare name
      // so calleeType has a chance to match a same-named in-repo struct.
      const parts = node.text.split(".");
      return parts[parts.length - 1] ?? null;
    }
    case "generic_type": {
      // Generic[T] → Generic
      for (const child of node.namedChildren) {
        if (
          child.type === "type_identifier" ||
          child.type === "qualified_type"
        ) {
          return extractTypeName(child);
        }
      }
      return null;
    }
    // Composite types — calling a method on a slice/map/etc. uses the
    // element/value type, not the container, so we'd need return-type
    // tracking to do better than null here.
    default:
      return null;
  }
}

// ------------------- Struct collection (first pass) -------------------

interface GoStruct {
  /** Field name → type name. Anonymous embeds and unsupported field shapes
   *  are skipped. */
  fields: Map<string, string>;
}

/** Walk the file's type_declarations and build name → struct-info. Methods
 *  are usually declared near (or after) their struct, so we need this map
 *  ready before walking method bodies. */
function collectStructs(root: TsNode): Map<string, GoStruct> {
  const out = new Map<string, GoStruct>();

  function visit(node: TsNode): void {
    if (node.type === "type_declaration") {
      for (const spec of node.namedChildren) {
        if (spec.type !== "type_spec") continue;
        const nameNode = spec.childForFieldName("name");
        const typeNode = spec.childForFieldName("type");
        if (!nameNode || !typeNode) continue;
        if (typeNode.type !== "struct_type") continue;
        out.set(nameNode.text, { fields: collectStructFields(typeNode) });
      }
    }
    for (const child of node.namedChildren) visit(child);
  }

  visit(root);
  return out;
}

/** Walk a struct_type node's field_declaration_list and pull out
 *  fieldName → typeName. Multi-name forms (`a, b string`) emit one entry
 *  per name. Embedded fields without explicit names are skipped in v1. */
function collectStructFields(structType: TsNode): Map<string, string> {
  const out = new Map<string, string>();
  for (const child of structType.namedChildren) {
    if (child.type !== "field_declaration_list") continue;
    for (const fd of child.namedChildren) {
      if (fd.type !== "field_declaration") continue;
      const typeNode = fd.childForFieldName("type");
      if (!typeNode) continue;
      const typeName = extractTypeName(typeNode);
      if (!typeName) continue;
      // field_identifier children are the field names. There can be multiple
      // for `a, b SomeType` syntax.
      for (const sub of fd.namedChildren) {
        if (sub.type === "field_identifier") {
          out.set(sub.text, typeName);
        }
      }
    }
  }
  return out;
}

// ------------------- ParsedClass extraction (v0.71) -------------------
//
// Go's notion of "class" is split across two AST shapes:
//
//   1. Struct types (`type X struct {...}`) — the field-bearing entity. Methods
//      are declared OUTSIDE the struct body via receiver syntax (`func (x *X)
//      M()`), so we have to do a second pass over method_declaration nodes and
//      attach method names by matching receiver types.
//
//   2. Interface types (`type Y interface {...}`) — the method-signature
//      bearing entity. method_elem children carry the signatures.
//
// Visibility in Go is convention-driven: capital first letter = exported
// (public), lowercase = unexported (private). We map that 1:1 to our
// ClassMemberVisibility model. There's no abstract/static/readonly concept —
// those flags are always false.
//
// What we don't capture in v1:
//   - Embedded structs / interface composition (would require more work to
//     decide whether to surface as parentClass or as fields)
//   - Interface satisfaction (Go is duck-typed; `implements` stays empty)

/** Map a Go identifier to public/private using the language's exported-name
 *  convention. */
function goVisibilityFromName(name: string): ClassMemberVisibility {
  if (!name) return "private";
  const first = name.charCodeAt(0);
  // Capital A-Z (and underscore) treated as exported. Lowercase = unexported.
  if (first >= 65 && first <= 90) return "public";
  return "private";
}

interface GoClassDraft {
  name: string;
  startRow: number;
  endRow: number;
  fields: ParsedField[];
  methodNames: string[];
  isInterface: boolean;
}

/** Walk the file once collecting struct + interface ParsedClass drafts.
 *  Method names are filled in by a second pass over method_declaration. */
function collectGoClassDrafts(root: TsNode): Map<string, GoClassDraft> {
  const out = new Map<string, GoClassDraft>();

  function visit(node: TsNode) {
    if (node.type === "type_declaration") {
      for (const spec of node.namedChildren) {
        if (spec.type !== "type_spec") continue;
        const nameNode = spec.childForFieldName("name");
        const typeNode = spec.childForFieldName("type");
        if (!nameNode || !typeNode) continue;
        const className = nameNode.text;

        if (typeNode.type === "struct_type") {
          out.set(className, {
            name: className,
            startRow: spec.startPosition.row,
            endRow: spec.endPosition.row,
            fields: collectGoStructFields(typeNode),
            methodNames: [],
            isInterface: false,
          });
        } else if (typeNode.type === "interface_type") {
          const methodNames: string[] = [];
          for (const member of typeNode.namedChildren) {
            if (member.type !== "method_elem") continue;
            // First named child of method_elem is the field_identifier
            // (method name). Embedded interfaces have type_identifier
            // shape and are skipped in v1.
            for (const c of member.namedChildren) {
              if (c.type === "field_identifier") {
                methodNames.push(c.text);
                break;
              }
            }
          }
          out.set(className, {
            name: className,
            startRow: spec.startPosition.row,
            endRow: spec.endPosition.row,
            fields: [],
            methodNames,
            isInterface: true,
          });
        }
      }
    }
    for (const child of node.namedChildren) visit(child);
  }

  visit(root);
  return out;
}

/** v0.71: type extraction for FIELD DISPLAY purposes. extractTypeName
 *  returns null for slices, maps, and other composite types (call-
 *  resolution can't do anything useful with `[]Foo.method()` so the
 *  bare-base extractor stays conservative). For diagram display we
 *  preserve container info: `cards []Card` shows as `[]Card`, and the
 *  classDiagram generator can pull `Card` out as the arrow target. */
function extractFieldType(node: TsNode): string | undefined {
  switch (node.type) {
    case "slice_type": {
      // `[]Foo` — single child is the element type.
      for (const child of node.namedChildren) {
        const inner = extractFieldType(child);
        if (inner) return `[]${inner}`;
      }
      return undefined;
    }
    case "map_type": {
      // `map[K]V` — first named child is key, second is value.
      const key = node.namedChildren[0]
        ? extractFieldType(node.namedChildren[0]) ?? "?"
        : "?";
      const val = node.namedChildren[1]
        ? extractFieldType(node.namedChildren[1]) ?? "?"
        : "?";
      return `map[${key}]${val}`;
    }
    case "pointer_type": {
      for (const child of node.namedChildren) {
        const inner = extractFieldType(child);
        if (inner) return `*${inner}`;
      }
      return undefined;
    }
    case "generic_type": {
      // Go 1.18+ generics: `Foo[T1, T2]`
      let base: string | undefined;
      const args: string[] = [];
      for (const child of node.namedChildren) {
        if (
          child.type === "type_identifier" ||
          child.type === "qualified_type"
        ) {
          base = extractTypeName(child) ?? undefined;
        } else if (child.type === "type_arguments") {
          for (const arg of child.namedChildren) {
            const inner = extractFieldType(arg);
            if (inner) args.push(inner);
          }
        }
      }
      if (!base) return undefined;
      return args.length > 0 ? `${base}[${args.join(", ")}]` : base;
    }
    default:
      return extractTypeName(node) ?? undefined;
  }
}

/** Field extraction for the rich ParsedClass shape. Mirrors collectStructFields
 *  (which returns a name→type Map for the type-tracking pass) but emits
 *  ParsedField with Go-convention visibility. */
function collectGoStructFields(structType: TsNode): ParsedField[] {
  const out: ParsedField[] = [];
  for (const child of structType.namedChildren) {
    if (child.type !== "field_declaration_list") continue;
    for (const fd of child.namedChildren) {
      if (fd.type !== "field_declaration") continue;
      const typeNode = fd.childForFieldName("type");
      const type = typeNode ? extractFieldType(typeNode) : undefined;
      // field_declaration may carry multiple field_identifier children for
      // `a, b SomeType` syntax — emit one ParsedField per identifier.
      for (const sub of fd.namedChildren) {
        if (sub.type !== "field_identifier") continue;
        const name = sub.text;
        out.push({
          name,
          type,
          visibility: goVisibilityFromName(name),
          isStatic: false,
          isReadonly: false,
        });
      }
    }
  }
  return out;
}

/** Walk all method_declaration nodes and attach method names to the matching
 *  struct draft via receiver type. Only attaches to known structs — methods
 *  on external types or unrecognized names are ignored. */
function attachGoMethodsToClasses(
  root: TsNode,
  drafts: Map<string, GoClassDraft>
): void {
  function visit(node: TsNode) {
    if (node.type === "method_declaration") {
      const nameNode = node.childForFieldName("name");
      const receiverNode = node.childForFieldName("receiver");
      if (nameNode && receiverNode) {
        const rcv = extractReceiver(receiverNode);
        if (rcv.type) {
          const draft = drafts.get(rcv.type);
          if (draft) draft.methodNames.push(nameNode.text);
        }
      }
    }
    for (const child of node.namedChildren) visit(child);
  }
  visit(root);
}

// ------------------- Param + receiver extraction -------------------

interface ReceiverInfo {
  name: string | null;
  type: string | null;
}

/** Pull (name, type) out of a method's receiver parameter list. Returns
 *  nulls for the rare "type-only receiver" form. */
function extractReceiver(receiverList: TsNode): ReceiverInfo {
  for (const param of receiverList.namedChildren) {
    if (param.type !== "parameter_declaration") continue;
    const nameNode = param.childForFieldName("name");
    const typeNode = param.childForFieldName("type");
    if (!typeNode) continue;
    return {
      name: nameNode?.text ?? null,
      type: extractTypeName(typeNode),
    };
  }
  return { name: null, type: null };
}

/** Collect parameter (name, type) pairs from a function or method's
 *  parameter_list. */
function collectParamTypes(fn: TsNode): Map<string, string> {
  const out = new Map<string, string>();
  const params = fn.childForFieldName("parameters");
  if (!params) return out;
  for (const p of params.namedChildren) {
    if (
      p.type !== "parameter_declaration" &&
      p.type !== "variadic_parameter_declaration"
    )
      continue;
    const typeNode = p.childForFieldName("type");
    if (!typeNode) continue;
    const typeName = extractTypeName(typeNode);
    if (!typeName) continue;
    // parameter_declaration may have multiple identifiers (`a, b int`).
    // Each identifier is a child of type "identifier".
    for (const sub of p.namedChildren) {
      if (sub.type === "identifier") out.set(sub.text, typeName);
    }
  }
  return out;
}

// ------------------- parseDirect -------------------

interface MethodScope {
  name: string;
  /** Variables in scope (params + locals + receiver). */
  locals: Map<string, string>;
  decisionPoints: number;
  /** Set on methods (not free functions). Used as the implicit receiver
   *  for bare calls inside the method body. */
  receiverType: string | null;
}

function parseGoDirect(file: SourceFile, ix: FileIndex): ParsedFile {
  if (!lang) {
    throw new Error("go plugin not loaded — call plugin.load() first");
  }
  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(file.content);
  if (!tree) {
    parser.delete();
    return errorParsedFile(file);
  }

  // Pass 1: build the struct table for this file (used for type-aware call
  // resolution in pass 3). Also collect ParsedClass drafts for the
  // Architecture tab.
  const structs = collectStructs(tree.rootNode);
  const classDrafts = collectGoClassDrafts(tree.rootNode);
  // Pass 2: attach method names to struct drafts via receiver matching.
  attachGoMethodsToClasses(tree.rootNode, classDrafts);

  // Pass 3: walk for imports, functions, calls, decision points.
  const imports: ParsedImport[] = [];
  const functions: ParsedFunction[] = [];
  const calls: ParsedCall[] = [];
  let totalDecisionPoints = 0;

  const seenImportSpecs = new Set<string>();
  const methodStack: MethodScope[] = [];

  function currentMethod(): MethodScope | null {
    return methodStack[methodStack.length - 1] ?? null;
  }

  function lookupVariableType(name: string): string | null {
    for (let i = methodStack.length - 1; i >= 0; i--) {
      const t = methodStack[i].locals.get(name);
      if (t) return t;
    }
    return null;
  }

  function countDecisionPoint() {
    totalDecisionPoints++;
    const m = currentMethod();
    if (m) m.decisionPoints++;
  }

  /** Recursively resolve the static type of an expression that appears as
   *  a call's receiver. Handles identifiers (var/param lookup),
   *  selector_expressions (struct field access), and parenthesized exprs. */
  function resolveOperandType(operand: TsNode): string | undefined {
    switch (operand.type) {
      case "identifier": {
        const t = lookupVariableType(operand.text);
        if (t) return t;
        // Fall through: bare identifier might be a package or class name.
        // Returning the name lets callers match same-named in-repo structs.
        return operand.text;
      }
      case "selector_expression": {
        // x.field — look up field's type in x's struct
        const inner = operand.childForFieldName("operand");
        const field = operand.childForFieldName("field");
        if (!inner || !field) return undefined;
        const innerType = resolveOperandType(inner);
        if (!innerType) return undefined;
        const struct = structs.get(innerType);
        if (struct) {
          const fieldType = struct.fields.get(field.text);
          if (fieldType) return fieldType;
        }
        return undefined;
      }
      case "parenthesized_expression": {
        // (*p).method() — unwrap and recurse
        const inner = operand.namedChildren[0];
        return inner ? resolveOperandType(inner) : undefined;
      }
      case "unary_expression": {
        // *p (deref) or &p (addr-of) — both can appear before a method call
        // if you parenthesize. Take the inner operand's type.
        const inner = operand.namedChildren[0];
        return inner ? resolveOperandType(inner) : undefined;
      }
      default:
        return undefined;
    }
  }

  /** Best-effort type inference for the right-hand side of `:=`. Only
   *  handles composite literals (`SomeType{...}`) and their pointer form
   *  (`&SomeType{...}`) — the most common idiomatic Go shape. Other forms
   *  (function calls, type assertions, etc.) require return-type tracking
   *  and stay untyped. */
  function inferExpressionType(expr: TsNode): string | null {
    switch (expr.type) {
      case "composite_literal": {
        const typeNode = expr.childForFieldName("type");
        return typeNode ? extractTypeName(typeNode) : null;
      }
      case "unary_expression": {
        // &T{} → T
        const operator = expr.childForFieldName("operator")?.text;
        const operand = expr.namedChildren[0];
        if (operator === "&" && operand) {
          return inferExpressionType(operand);
        }
        return null;
      }
      default:
        return null;
    }
  }

  function visit(node: TsNode) {
    switch (node.type) {
      case "import_spec": {
        const pathNode = node.childForFieldName("path");
        if (!pathNode) return;
        const spec = pathNode.text.replace(STRING_QUOTES_RE, "");
        if (!spec || seenImportSpecs.has(spec)) return;
        seenImportSpecs.add(spec);
        imports.push({
          rawSpec: pathNode.text, // resolveImport strips quotes
          resolvedPath: resolveGoImport(pathNode.text, file.rel, ix),
        });
        return;
      }

      case "type_declaration":
        // Already handled in pass 1; just descend into children for any
        // nested function literals (rare).
        for (const child of node.namedChildren) visit(child);
        return;

      case "function_declaration": {
        const nameNode = node.childForFieldName("name");
        const fnName = nameNode?.text ?? "<anon>";
        const startRow = node.startPosition.row;
        const endRow = node.endPosition.row;
        const locals = collectParamTypes(node);
        methodStack.push({
          name: fnName,
          locals,
          decisionPoints: 0,
          receiverType: null,
        });
        const body = node.childForFieldName("body");
        if (body) for (const child of body.namedChildren) visit(child);
        const ms = methodStack.pop()!;
        functions.push({
          name: fnName,
          startRow,
          endRow,
          complexity: 1 + ms.decisionPoints,
          // free functions have no containerType
          bodyHash: body ? hashSubtree(body) : undefined,
        });
        return;
      }

      case "method_declaration": {
        const nameNode = node.childForFieldName("name");
        const fnName = nameNode?.text ?? "<anon>";
        const startRow = node.startPosition.row;
        const endRow = node.endPosition.row;

        const receiverNode = node.childForFieldName("receiver");
        let receiverType: string | null = null;
        let receiverName: string | null = null;
        if (receiverNode) {
          const rcv = extractReceiver(receiverNode);
          receiverName = rcv.name;
          receiverType = rcv.type;
        }

        const locals = collectParamTypes(node);
        if (receiverName && receiverType) {
          locals.set(receiverName, receiverType);
        }

        methodStack.push({
          name: fnName,
          locals,
          decisionPoints: 0,
          receiverType,
        });
        const body = node.childForFieldName("body");
        if (body) for (const child of body.namedChildren) visit(child);
        const ms = methodStack.pop()!;
        functions.push({
          name: fnName,
          startRow,
          endRow,
          complexity: 1 + ms.decisionPoints,
          containerType: receiverType ?? undefined,
          bodyHash: body ? hashSubtree(body) : undefined,
        });
        return;
      }

      case "var_declaration": {
        // var_declaration > var_spec
        for (const spec of node.namedChildren) {
          if (spec.type !== "var_spec") continue;
          const typeNode = spec.childForFieldName("type");
          if (!typeNode) continue;
          const typeName = extractTypeName(typeNode);
          if (!typeName) continue;
          const m = currentMethod();
          if (!m) continue;
          for (const sub of spec.namedChildren) {
            if (sub.type === "identifier") {
              m.locals.set(sub.text, typeName);
            }
          }
        }
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "short_var_declaration": {
        // x := value — try composite-literal inference for the rhs
        const left = node.childForFieldName("left");
        const right = node.childForFieldName("right");
        if (left && right) {
          const leftIds = left.namedChildren.filter(
            (c) => c.type === "identifier"
          );
          const rightExprs = right.namedChildren;
          const m = currentMethod();
          if (m) {
            for (
              let i = 0;
              i < Math.min(leftIds.length, rightExprs.length);
              i++
            ) {
              const inferred = inferExpressionType(rightExprs[i]);
              if (inferred) m.locals.set(leftIds[i].text, inferred);
            }
          }
        }
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "call_expression": {
        const fnNode = node.childForFieldName("function");
        if (fnNode) {
          let calleeName: string | null = null;
          let calleeType: string | undefined;

          if (fnNode.type === "identifier") {
            calleeName = fnNode.text;
            // Bare call inside a method → implicit receiver
            const m = currentMethod();
            if (m?.receiverType) calleeType = m.receiverType;
          } else if (fnNode.type === "selector_expression") {
            const operand = fnNode.childForFieldName("operand");
            const field = fnNode.childForFieldName("field");
            if (field) calleeName = field.text;
            if (operand) calleeType = resolveOperandType(operand);
          }

          if (calleeName) {
            calls.push({
              calleeName,
              inFunction: currentMethod()?.name ?? null,
              calleeType,
            });
          }
        }
        // Visit children for nested calls (in arguments, etc.)
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "if_statement":
      case "for_statement":
      case "expression_case":
      case "type_case":
      case "communication_case":
        countDecisionPoint();
        for (const child of node.namedChildren) visit(child);
        return;

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

  // v0.71: assemble final ParsedClass[] from drafts. Most Go-specific bits
  // (no inheritance, duck-typed interfaces, no abstract concept) collapse to
  // empty arrays / falsy flags here.
  const parsedClasses: ParsedClass[] = [];
  for (const draft of classDrafts.values()) {
    parsedClasses.push({
      name: draft.name,
      startRow: draft.startRow,
      endRow: draft.endRow,
      fields: draft.fields,
      methodNames: draft.methodNames,
      parentClass: undefined,
      implements: [],
      isInterface: draft.isInterface,
      isAbstract: false,
    });
  }

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

// ------------------- Import resolution -------------------

function resolveGoImport(
  spec: string,
  _fromPath: string,
  ix: FileIndex
): string | null {
  const importPath = spec.replace(STRING_QUOTES_RE, "");
  if (!importPath) return null;

  const ctx = ix.extras.get(PLUGIN_NAME) as GoResolverContext | undefined;

  if (ctx?.modulePath) {
    const prefix = ctx.modulePath;
    if (importPath === prefix) {
      const root = findGoFileInDir("", ix);
      if (root) return root;
    } else if (importPath.startsWith(prefix + "/")) {
      const subpath = importPath.slice(prefix.length + 1);
      const hit = findGoFileInDir(subpath, ix);
      if (hit) return hit;
    }
  }

  const parts = importPath.split("/");
  for (let take = Math.min(parts.length, 4); take >= 1; take--) {
    const suffix = parts.slice(-take).join("/");
    const hit = findGoFileBySuffix(suffix, ix);
    if (hit) return hit;
  }

  return null;
}

function findGoFileInDir(dir: string, ix: FileIndex): string | null {
  const candidates: string[] = [];
  const prefix = dir === "" ? "" : dir.replace(/\/$/, "") + "/";
  for (const key of ix.byPath.keys()) {
    if (!key.endsWith(".go")) continue;
    if (prefix === "") {
      if (!key.includes("/")) candidates.push(key);
    } else {
      if (key.startsWith(prefix) && !key.slice(prefix.length).includes("/")) {
        candidates.push(key);
      }
    }
  }
  candidates.sort();
  return candidates[0] ?? null;
}

function findGoFileBySuffix(suffix: string, ix: FileIndex): string | null {
  const candidates: string[] = [];
  for (const key of ix.byPath.keys()) {
    if (!key.endsWith(".go")) continue;
    if (
      key.startsWith(`${suffix}/`) ||
      key.includes(`/${suffix}/`) ||
      path.posix.dirname(key).endsWith(suffix)
    ) {
      candidates.push(key);
    }
  }
  candidates.sort();
  return candidates[0] ?? null;
}

// ------------------- Plugin -------------------

export const goPlugin = {
  name: PLUGIN_NAME,
  extensions: EXTENSIONS,

  async load() {
    if (lang) return;
    lang = await loadBuiltinGrammar("tree-sitter-go");
  },

  async prepareForRepo(root: string, ix: FileIndex) {
    let modulePath: string | null = null;
    try {
      const content = await fs.readFile(path.join(root, "go.mod"), "utf-8");
      const m = /^\s*module\s+(\S+)/m.exec(content);
      if (m) modulePath = m[1];
    } catch {
      // No go.mod — suffix-only resolution
    }
    const ctx: GoResolverContext = { modulePath };
    ix.extras.set(PLUGIN_NAME, ctx);
  },

  // languageFor + queriesFor preserved for any caller that prefers the
  // standard pipeline; the orchestrator routes through parseDirect.
  languageFor(_ext) {
    if (!lang) {
      throw new Error(
        `go plugin not loaded — call plugin.load() before languageFor()`
      );
    }
    return lang;
  },

  queriesFor(_ext): PluginQueries {
    return QUERIES;
  },

  parseDirect: parseGoDirect,

  resolveImport: resolveGoImport,
} satisfies CodeAnalysisPlugin;
