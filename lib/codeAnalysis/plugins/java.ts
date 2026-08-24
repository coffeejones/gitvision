// Java plugin — third migration off the regex-fallback, type-aware since v0.15.
//
// What this plugin does that javascript.ts / python.ts / go.ts don't (yet):
//   1. Tracks variable types in scope while walking the AST (class fields,
//      method parameters, local variable declarations).
//   2. Resolves call receivers to a static type when possible — for
//      `validatePassword.validate(...)`, the receiver `validatePassword` has
//      a known type `ValidatePassword`, so the call gets `calleeType` set.
//   3. Emits FunctionDef.containerType for every method (the enclosing class
//      name).
//
// Why this matters: codeGraph.pickCallTarget uses calleeType + containerType
// as the primary disambiguator. Without it, a call to `validate()` ambiguous
// between 7 ValidateXxx classes would be picked by file order — wrong half
// the time. With it, we deterministically resolve to ValidatePassword's
// validate.
//
// Implementation note: this plugin uses the parseDirect path instead of the
// standard tree-sitter pipeline because type tracking needs ordered AST
// traversal (we maintain a scope stack). Queries can find call sites but
// can't tell us "which variable's type is this call's receiver" without
// walking the tree ourselves.

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

const PLUGIN_NAME = "java";
const EXTENSIONS = ["java"] as const;

let lang: Language | null = null;

// ------------------- Module-level resolver context -------------------

interface JavaResolverContext {
  /** FQN ("com.foo.Bar") → repo-rel path. Built from package declarations
   *  + filename in prepareForRepo. */
  fqnToPath: Map<string, string>;
  /** Package name ("com.foo") → repo-rel paths in that package. Used to
   *  resolve wildcard imports. Sorted alphabetically for determinism. */
  packageMembers: Map<string, string[]>;
}

// Detects the package declaration at the top of a Java file. Allows leading
// whitespace and comments — Java's grammar permits both before `package`.
const PACKAGE_RE = /^\s*package\s+([a-zA-Z0-9_.]+)\s*;/m;

// ------------------- Index construction -------------------

function buildJavaContext(ix: FileIndex): JavaResolverContext {
  const fqnToPath = new Map<string, string>();
  const packageMembers = new Map<string, string[]>();

  for (const f of ix.byPath.values()) {
    if (f.ext !== "java") continue;
    const head = f.content.slice(0, 2048);
    const m = PACKAGE_RE.exec(head);
    const pkg = m?.[1] ?? null;
    const className = path.posix.basename(f.rel, ".java");
    const fqn = pkg ? `${pkg}.${className}` : className;
    fqnToPath.set(fqn, f.rel);
    if (pkg) {
      let members = packageMembers.get(pkg);
      if (!members) {
        members = [];
        packageMembers.set(pkg, members);
      }
      members.push(f.rel);
    }
  }

  for (const arr of packageMembers.values()) arr.sort();

  return { fqnToPath, packageMembers };
}

// ------------------- Import resolution -------------------

function resolveJavaImport(
  spec: string,
  _fromPath: string,
  ix: FileIndex
): string | null {
  const ctx = ix.extras.get(PLUGIN_NAME) as JavaResolverContext | undefined;
  if (!ctx) return null;
  const direct = ctx.fqnToPath.get(spec);
  if (direct) return direct;
  const members = ctx.packageMembers.get(spec);
  if (members && members.length > 0) return members[0];
  return null;
}

// ------------------- Tree-sitter queries (kept for reference + tests) -------------------
//
// These are no longer used by parseDirect — we walk the AST manually for type
// tracking. They're retained as documentation of what the queries WOULD look
// like, and are still exposed via queriesFor() so the plugin contract stays
// satisfied for any caller that uses the standard pipeline.

const QUERIES: PluginQueries = {
  imports: `(import_declaration (scoped_identifier) @spec)`,
  functionDefs: `
    (method_declaration name: (identifier) @name body: (block) @body)
    (constructor_declaration name: (identifier) @name body: (constructor_body) @body)
  `,
  callSites: `
    (method_invocation name: (identifier) @callee)
    (object_creation_expression type: (type_identifier) @callee)
    (object_creation_expression type: (generic_type (type_identifier) @callee))
  `,
  decisionPoints: `
    (if_statement) @p
    (while_statement) @p
    (for_statement) @p
    (enhanced_for_statement) @p
    (do_statement) @p
    ((switch_label) @p (#match? @p "^case"))
    (catch_clause) @p
    (binary_expression operator: "&&") @p
    (binary_expression operator: "||") @p
    (ternary_expression) @p
  `,
};

// ------------------- Type extraction -------------------

/** Extract a type name (just the bare class name) from a Java type AST node.
 *  Returns null for arrays and types we can't statically resolve.
 *
 *  v0.71: primitives (`int`, `long`, `double`, `boolean`, ...) and `void`
 *  now return their literal text. They don't resolve to anything in our
 *  FunctionDef index (so call-resolution still skips them gracefully — no
 *  candidate matches "int.foo()"), but they DO surface as field types in
 *  the Architecture tab so a `private int id;` reads as "id : int" instead
 *  of an empty entry. The type-tracking pass calls extractTypeName for
 *  field/param types — primitives there are harmless because lookupVariableType
 *  is a Map: callers ask for a class with the name "int", get nothing back,
 *  fall through. */
function extractTypeName(node: TsNode): string | null {
  switch (node.type) {
    case "type_identifier":
      return node.text;
    case "integral_type":
    case "floating_point_type":
    case "boolean_type":
    case "void_type":
      // The keyword (`int`, `double`, `boolean`, `void`) is the node's
      // text — tree-sitter-java exposes these as dedicated leaf types
      // rather than under a generic "primitive" umbrella.
      return node.text;
    case "generic_type": {
      // generic_type's first named child is the base type (type_identifier
      // or scoped_type_identifier)
      for (const child of node.namedChildren) {
        if (
          child.type === "type_identifier" ||
          child.type === "scoped_type_identifier"
        ) {
          return extractTypeName(child);
        }
      }
      return null;
    }
    case "scoped_type_identifier": {
      // "java.util.Map.Entry" → "Entry" (last segment). Type tracking against
      // qualified names is rare in practice and the bare class name matches
      // our FQN→path index just as well.
      const parts = node.text.split(".");
      return parts[parts.length - 1] ?? null;
    }
    case "array_type": {
      // "Dish[]". Kept WITH the suffix so it can never match a containerType by
      // accident, and so `array_access` below has something to strip. Before
      // this an array local was simply untyped, which is why
      // `dishes[i].price()` in a JUnit test resolved to nothing and the price
      // method read as untested.
      const el = node.childForFieldName("element");
      const inner = el ? extractTypeName(el) : null;
      return inner ? `${inner}[]` : null;
    }
    // Other shapes drop through.
    default:
      return null;
  }
}

/** Walk class body for field declarations, return name→type map. */
function collectFieldTypes(classBody: TsNode): Map<string, string> {
  const out = new Map<string, string>();
  for (const child of classBody.namedChildren) {
    if (child.type !== "field_declaration") continue;
    const typeNode = child.childForFieldName("type");
    if (!typeNode) continue;
    const typeName = extractTypeName(typeNode);
    if (!typeName) continue;
    // field_declaration may have multiple variable_declarator children for
    // forms like `int a, b, c;` — collect each name with the same type.
    for (const sub of child.namedChildren) {
      if (sub.type !== "variable_declarator") continue;
      const nameNode = sub.childForFieldName("name");
      if (nameNode?.text) out.set(nameNode.text, typeName);
    }
  }
  return out;
}

/** v0.71: type extraction for FIELD DISPLAY purposes (Architecture
 *  tab). Different from extractTypeName because:
 *    - extractTypeName returns the BARE base ("List" for List<Card>)
 *      because the type-tracking pass keys class lookups by base name.
 *    - extractFieldType returns the parameterized form ("List<Card>")
 *      so the diagram preserves "this is a List of Cards" — and the
 *      classDiagram generator can pull out the element type to draw
 *      composition arrows from Card to its container.
 *  Calling both on the same node is intentional — they serve different
 *  consumers. */
function extractFieldType(node: TsNode): string | undefined {
  const base = extractTypeName(node);
  if (!base) return undefined;
  if (node.type !== "generic_type") return base;
  // generic_type has a `type_arguments` child holding the inner types.
  // Walk it for each named child and recursively extract a display name.
  const args: string[] = [];
  for (const child of node.namedChildren) {
    if (child.type !== "type_arguments") continue;
    for (const arg of child.namedChildren) {
      const inner = extractFieldType(arg);
      if (inner) args.push(inner);
    }
  }
  if (args.length === 0) return base;
  return `${base}<${args.join(", ")}>`;
}

/** v0.71: rich field metadata for the Architecture-tab Mermaid
 *  generator. Same shape as the JS version — visibility / static /
 *  final keywords pulled from the modifiers child. Java has explicit
 *  modifiers so we can be precise about everything. */
function collectFullClassFields(classBody: TsNode): ParsedField[] {
  const out: ParsedField[] = [];
  for (const child of classBody.namedChildren) {
    if (child.type !== "field_declaration") continue;

    // Modifier detection. Java field_declaration has an optional
    // `modifiers` child holding `public`/`private`/`protected`/
    // `static`/`final` etc as separate keyword nodes. Note: those
    // keyword nodes are ANONYMOUS in tree-sitter-java's grammar
    // (named=false), so we must walk `children` not `namedChildren`.
    let visibility: ClassMemberVisibility = "internal"; // package-private
    let isStatic = false;
    let isReadonly = false;
    const modifiersNode = child.namedChildren.find(
      (c): c is TsNode => !!c && c.type === "modifiers"
    );
    if (modifiersNode) {
      for (let i = 0; i < modifiersNode.childCount; i++) {
        const m = modifiersNode.child(i);
        if (!m) continue;
        const t = m.type;
        if (t === "public") visibility = "public";
        else if (t === "private") visibility = "private";
        else if (t === "protected") visibility = "protected";
        else if (t === "static") isStatic = true;
        else if (t === "final") isReadonly = true;
      }
    }

    const typeNode = child.childForFieldName("type");
    const type = typeNode ? extractFieldType(typeNode) : undefined;

    for (const sub of child.namedChildren) {
      if (sub.type !== "variable_declarator") continue;
      const nameNode = sub.childForFieldName("name");
      const name = nameNode?.text;
      if (!name) continue;
      out.push({ name, type, visibility, isStatic, isReadonly });
    }
  }
  return out;
}

/** Extract the parent class name from a class_declaration's
 *  superclass clause (`extends Foo`). Returns undefined when the
 *  class doesn't extend anything (or extends Object implicitly). */
function extractJavaParent(classNode: TsNode): string | undefined {
  // Tree-sitter-java exposes the extends clause as a `superclass`
  // child. Inside it, the first type_identifier is the parent.
  const superclass = classNode.childForFieldName("superclass");
  if (!superclass) return undefined;
  for (const child of superclass.namedChildren) {
    if (child.type === "type_identifier") return child.text;
    if (child.type === "generic_type") {
      const inner = child.childForFieldName("name");
      if (inner) return inner.text;
    }
  }
  return undefined;
}

/** Extract the names listed in a class's `implements` clause.
 *  Empty array when the class implements nothing. */
function extractJavaImplements(classNode: TsNode): string[] {
  const interfaces = classNode.childForFieldName("interfaces");
  if (!interfaces) return [];
  const out: string[] = [];
  // The interfaces field wraps a `super_interfaces` node which
  // contains a `type_list` of identifiers.
  function walkForIdents(n: TsNode) {
    if (n.type === "type_identifier") {
      out.push(n.text);
      return;
    }
    if (n.type === "generic_type") {
      const inner = n.childForFieldName("name");
      if (inner) out.push(inner.text);
      return;
    }
    for (const child of n.namedChildren) walkForIdents(child);
  }
  walkForIdents(interfaces);
  return out;
}

/** v0.71: walk an enum_declaration's enum_body for the constant
 *  names. Each enum_constant child holds a single identifier with
 *  the value's literal name (`RED`, `GREEN`, `BLUE`). Order is
 *  preserved from source. */
function collectJavaEnumValues(enumBody: TsNode): string[] {
  const out: string[] = [];
  for (const child of enumBody.namedChildren) {
    if (child.type !== "enum_constant") continue;
    const idNode = child.namedChildren.find((c) => c.type === "identifier");
    if (idNode?.text) out.push(idNode.text);
  }
  return out;
}

/** True when the class declares the `abstract` modifier. The
 *  modifier keyword is anonymous in tree-sitter-java, so we walk
 *  `children` not `namedChildren`. */
function isAbstractClass(classNode: TsNode): boolean {
  const modifiersNode = classNode.namedChildren.find(
    (c): c is TsNode => !!c && c.type === "modifiers"
  );
  if (!modifiersNode) return false;
  for (let i = 0; i < modifiersNode.childCount; i++) {
    const m = modifiersNode.child(i);
    if (m && m.type === "abstract") return true;
  }
  return false;
}

/** Walk a method's formal_parameters, return name→type map. */
function collectParamTypes(methodNode: TsNode): Map<string, string> {
  const out = new Map<string, string>();
  const params = methodNode.childForFieldName("parameters");
  if (!params) return out;
  for (const p of params.namedChildren) {
    if (p.type !== "formal_parameter" && p.type !== "spread_parameter") continue;
    const typeNode = p.childForFieldName("type");
    const nameNode = p.childForFieldName("name");
    if (!typeNode || !nameNode) continue;
    const typeName = extractTypeName(typeNode);
    if (typeName) out.set(nameNode.text, typeName);
  }
  return out;
}

// ------------------- parseDirect: AST walk with type tracking -------------------

interface MethodScope {
  name: string;
  /** Local variables (including parameters) → type. Pushed by the param
   *  collector; extended as we encounter local_variable_declaration nodes. */
  locals: Map<string, string>;
  /** McCabe decision points encountered inside this method's body. */
  decisionPoints: number;
}

interface ClassScope {
  name: string;
  fields: Map<string, string>;
}

function parseJavaDirect(file: SourceFile, _ix: FileIndex): ParsedFile {
  if (!lang) {
    throw new Error("java plugin not loaded — call plugin.load() first");
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
  /** v0.71: full ParsedClass entries for the Architecture-tab
   *  Mermaid generator. Captured alongside the existing classStack
   *  entries (which only carry name + field types for type-aware
   *  call resolution). */
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

  /** Look up a variable's type in the current scope, walking outwards from
   *  innermost method through class fields. */
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

  /** Bumps both the file-total counter and the innermost method's local
   *  counter (for per-function complexity). */
  function countDecisionPoint() {
    totalDecisionPoints++;
    const m = currentMethod();
    if (m) m.decisionPoints++;
  }

  /** Resolve the calleeType for a method_invocation given its receiver
   *  (`object` field). Returns the type when statically inferable. */
  function resolveCalleeType(objectNode: TsNode | null): string | undefined {
    const cls = currentClass();
    // Bare call: `helper()` → implicit `this`, type = current class
    if (!objectNode) return cls?.name ?? undefined;

    switch (objectNode.type) {
      case "this":
        return cls?.name ?? undefined;
      case "super": {
        // We don't track inheritance edges yet — leave undefined. Java's
        // call resolver will fall back to name-match for super.method() calls.
        return undefined;
      }
      case "identifier": {
        // Could be a variable in scope OR a class name (for static calls).
        const t = lookupVariableType(objectNode.text);
        if (t) return t;
        // Treat the bare identifier itself as a possible class name. This
        // catches `Math.max(...)` where Math isn't a variable. The candidate
        // disambiguator will succeed when there's a class with that name in
        // our function index.
        return objectNode.text;
      }
      case "field_access": {
        // `this.field.method()` — field is on the current class
        const objField = objectNode.childForFieldName("object");
        const fieldName = objectNode.childForFieldName("field")?.text;
        if (!fieldName) return undefined;
        if (objField?.type === "this") {
          return cls?.fields.get(fieldName);
        }
        // `Dish.FESTIVALBURGER.price()` — an enum constant. The value's type is
        // the enum itself, which is the one static-field shape where the type
        // is knowable without reading the other file.
        //
        // Recognised by Java's own two conventions rather than by knowing the
        // declaration: a receiver that starts uppercase is a type name, and a
        // SCREAMING_SNAKE member is a constant. That does misfire on a non-enum
        // constant — `Config.MAX_SIZE.length()` reports calleeType "Config" —
        // but the resolver requires containerType === calleeType with an
        // explicit receiver, so a wrong type costs a MISSED edge, never an
        // invented one. Asserted both ways in java.test.ts.
        if (
          objField?.type === "identifier" &&
          !lookupVariableType(objField.text) &&
          /^[A-Z]/.test(objField.text) &&
          /^[A-Z][A-Z0-9_]*$/.test(fieldName)
        ) {
          return objField.text;
        }
        // Other shapes (chained, etc.) — out of scope
        return undefined;
      }

      case "array_access": {
        // `dishes[i].price()` — the element type is the array type minus "[]".
        const arrayNode = objectNode.childForFieldName("array");
        if (arrayNode?.type !== "identifier") return undefined;
        const arrayType = lookupVariableType(arrayNode.text);
        return arrayType?.endsWith("[]") ? arrayType.slice(0, -2) : undefined;
      }
      // method_invocation, parenthesized_expression, etc. — we'd need return-
      // type tracking. Skip in v1.
      default:
        return undefined;
    }
  }

  function visit(node: TsNode) {
    switch (node.type) {
      case "import_declaration": {
        // Find the scoped_identifier child — it's not a field on
        // import_declaration, just a child node.
        let spec: string | null = null;
        for (const child of node.namedChildren) {
          if (child.type === "scoped_identifier") {
            spec = child.text;
            break;
          }
        }
        if (spec && !seenImportSpecs.has(spec)) {
          seenImportSpecs.add(spec);
          imports.push({
            rawSpec: spec,
            resolvedPath: resolveJavaImport(spec, file.rel, _ix),
          });
        }
        return; // imports have no nested calls/decisions worth visiting
      }

      case "class_declaration":
      case "interface_declaration":
      case "enum_declaration":
      case "record_declaration": {
        const nameNode = node.childForFieldName("name");
        const className = nameNode?.text ?? "<anon>";
        const bodyNode = node.childForFieldName("body");
        const fields = bodyNode
          ? collectFieldTypes(bodyNode)
          : new Map<string, string>();
        classStack.push({ name: className, fields });

        // Collect method names from the body BEFORE we recurse —
        // we need to know them to populate ParsedClass.methodNames
        // and the codeGraph aggregator can match them to FunctionDef
        // entries by (containerType, name).
        const methodNames: string[] = [];
        if (bodyNode) {
          // An ENUM keeps its methods one level deeper, under
          // enum_body_declarations, after the constant list. Reading only the
          // direct children left every enum with zero methods — Dish declared
          // four and reported none, so the aggregator had nothing to match
          // against the FunctionDefs carrying containerType "Dish". The
          // existing test used `enum Color { RED, GREEN, BLUE }`, an enum with
          // no body at all, which is why it never showed.
          const members = bodyNode.namedChildren.flatMap((m) =>
            m.type === "enum_body_declarations" ? m.namedChildren : [m]
          );
          for (const member of members) {
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

        // Walk body so nested methods/classes get visited
        if (bodyNode) {
          for (const child of bodyNode.namedChildren) visit(child);
        }
        classStack.pop();

        // v0.71: emit ParsedClass for the Architecture tab. Anonymous
        // classes are skipped (no useful diagram entity). Records
        // continue to be skipped (their primary-constructor parameter
        // syntax doesn't fit our field model). Enums get a dedicated
        // path below — they have their own AST shape (enum_constant
        // children) and a distinct stereotype in the diagram.
        if (
          className !== "<anon>" &&
          (node.type === "class_declaration" ||
            node.type === "interface_declaration") &&
          bodyNode
        ) {
          parsedClasses.push({
            name: className,
            startRow: node.startPosition.row,
            endRow: node.endPosition.row,
            fields: collectFullClassFields(bodyNode),
            methodNames,
            parentClass: extractJavaParent(node),
            implements: extractJavaImplements(node),
            isInterface: node.type === "interface_declaration",
            isAbstract: isAbstractClass(node),
          });
        } else if (
          className !== "<anon>" &&
          node.type === "enum_declaration" &&
          bodyNode
        ) {
          parsedClasses.push({
            name: className,
            startRow: node.startPosition.row,
            endRow: node.endPosition.row,
            fields: [],
            methodNames,
            implements: extractJavaImplements(node),
            isEnum: true,
            enumValues: collectJavaEnumValues(bodyNode),
          });
        }
        return;
      }

      case "method_declaration":
      case "constructor_declaration": {
        const nameNode = node.childForFieldName("name");
        const fnName = nameNode?.text ?? "<anon>";
        const startRow = node.startPosition.row;
        const endRow = node.endPosition.row;
        const params = collectParamTypes(node);
        const locals = new Map(params); // params are visible like locals
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

      case "local_variable_declaration": {
        const typeNode = node.childForFieldName("type");
        const typeName = typeNode ? extractTypeName(typeNode) : null;
        if (typeName) {
          const m = currentMethod();
          if (m) {
            for (const sub of node.namedChildren) {
              if (sub.type !== "variable_declarator") continue;
              const varName = sub.childForFieldName("name")?.text;
              if (varName) m.locals.set(varName, typeName);
            }
          }
        }
        // Continue visiting — initializers may contain calls / decisions
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "method_invocation": {
        const nameNode = node.childForFieldName("name");
        const calleeName = nameNode?.text;
        if (calleeName) {
          const objectNode = node.childForFieldName("object");
          calls.push({
            calleeName,
            inFunction: currentMethod()?.name ?? null,
            fromContainerType: currentClass()?.name,
            calleeType: resolveCalleeType(objectNode),
            // An explicit receiver (obj.method()) engages the resolver's
            // strict guard against false name-collision matches on untyped
            // receivers; a bare foo() (implicit this) keeps the old behavior.
            hasReceiver: !!objectNode,
          });
        }
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "enum_constant": {
        // `FESTIVALBURGER("Festivalburger", 59)` invokes the enum's
        // constructor. Java writes it without `new` and without a receiver, so
        // it matched neither call shape below and produced no edge at all —
        // the constructor came out with zero inbound callers of any kind, which
        // is a different failure from the unresolved-receiver one above: there
        // was nothing to resolve.
        //
        // Only when arguments are present. A bare `RED` in `enum Color { RED }`
        // uses the implicit no-arg constructor, which the plugin does not emit
        // as a function, so an edge would point at nothing.
        const args = node.namedChildren.find((c) => c.type === "argument_list");
        const enumName = currentClass()?.name;
        if (args && enumName) {
          calls.push({
            calleeName: enumName,
            // Class-scope: a constant is not written inside a method. The graph
            // keeps the edge; blastRadius skips module-scope callers, so this
            // does not by itself move the caller COUNT on a card.
            inFunction: currentMethod()?.name ?? null,
            fromContainerType: enumName,
            calleeType: enumName,
            hasReceiver: true,
          });
        }
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "object_creation_expression": {
        // `new Foo()` / `new Foo<>()` — calleeName is the class itself.
        // calleeType = same class (you're calling its constructor).
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

      case "enhanced_for_statement": {
        // `for (Dish dish : Dish.values())` declares a typed local, and it was
        // the only declaration form the plugin never recorded. The old path
        // fell through to the identifier branch of resolveCalleeType, which
        // returns the identifier itself as a possible class name — so
        // `dish.price()` went out with calleeType "dish", the VARIABLE name
        // used as a type. Unresolvable by construction.
        countDecisionPoint();
        const loopType = node.childForFieldName("type");
        const loopName = node.childForFieldName("name")?.text;
        const typeName = loopType ? extractTypeName(loopType) : null;
        if (loopName && typeName) currentMethod()?.locals.set(loopName, typeName);
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "if_statement":
      case "while_statement":
      case "for_statement":
      case "do_statement":
      case "catch_clause":
      case "ternary_expression":
        countDecisionPoint();
        for (const child of node.namedChildren) visit(child);
        return;

      case "switch_label": {
        // Count `case X:` clauses but not `default:` — matches the JS plugin's
        // McCabe convention.
        if (node.text.startsWith("case")) countDecisionPoint();
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

export const javaPlugin = {
  name: PLUGIN_NAME,
  extensions: EXTENSIONS,

  async load() {
    if (lang) return;
    lang = await loadBuiltinGrammar("tree-sitter-java");
  },

  async prepareForRepo(_root: string, ix: FileIndex) {
    ix.extras.set(PLUGIN_NAME, buildJavaContext(ix));
  },

  // languageFor + queriesFor are kept defined for any consumer that wants to
  // inspect them (e.g. tests), but the orchestrator routes through parseDirect.
  languageFor(_ext) {
    if (!lang) {
      throw new Error(
        `java plugin not loaded — call plugin.load() before languageFor()`
      );
    }
    return lang;
  },

  queriesFor(_ext): PluginQueries {
    return QUERIES;
  },

  parseDirect: parseJavaDirect,

  resolveImport: resolveJavaImport,
} satisfies CodeAnalysisPlugin;
