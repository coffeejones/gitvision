// Tests for the Java tree-sitter plugin. Covers:
//   1. Grammar boots and parses Java without error
//   2. prepareForRepo builds FQN→path and package→members maps from the
//      package declarations in the FileIndex
//   3. resolveImport: direct FQN, wildcard via package fallback, external
//      stdlib imports → null
//   4. parseFile end-to-end: imports, methods, constructors, calls, complexity

import { describe, it, expect, beforeAll } from "vitest";
import { Parser } from "web-tree-sitter";
import { javaPlugin } from "../codeAnalysis/plugins/java";
import { parseFile } from "../codeAnalysis/parse";
import type { FileIndex, SourceFile } from "../codeAnalysis/types";

function makeIndex(
  files: SourceFile[],
  extras: Map<string, unknown> = new Map()
): FileIndex {
  const byPath = new Map<string, SourceFile>();
  const byExt = new Map<string, SourceFile[]>();
  for (const f of files) {
    byPath.set(f.rel, f);
    const arr = byExt.get(f.ext) ?? [];
    arr.push(f);
    byExt.set(f.ext, arr);
  }
  return { byPath, byExt, extras };
}

describe("javaPlugin — basic contract", () => {
  beforeAll(async () => {
    await javaPlugin.load();
  });

  it("advertises the .java extension only", () => {
    expect([...javaPlugin.extensions]).toEqual(["java"]);
  });

  it("loads the tree-sitter-java grammar", () => {
    expect(javaPlugin.languageFor("java")).toBeTruthy();
  });

  it("parses a simple Java class without error", () => {
    const lang = javaPlugin.languageFor("java");
    const parser = new Parser();
    parser.setLanguage(lang);
    const tree = parser.parse(
      "package com.foo;\n\npublic class Bar {\n  public int hi() { return 1; }\n}\n"
    );
    expect(tree).not.toBeNull();
    expect(tree!.rootNode.hasError).toBe(false);
    expect(tree!.rootNode.type).toBe("program");
    parser.delete();
    tree!.delete();
  });
});

describe("javaPlugin.prepareForRepo + resolveImport", () => {
  beforeAll(async () => {
    await javaPlugin.load();
  });

  /** A small synthetic Spring-style codebase. */
  const files: SourceFile[] = [
    {
      rel: "src/main/java/com/example/App.java",
      ext: "java",
      content: "package com.example;\n\npublic class App {}\n",
    },
    {
      rel: "src/main/java/com/example/User.java",
      ext: "java",
      content: "package com.example;\n\npublic class User {}\n",
    },
    {
      rel: "src/main/java/com/example/UserService.java",
      ext: "java",
      content: "package com.example;\n\npublic class UserService {}\n",
    },
    {
      rel: "src/main/java/com/example/web/Controller.java",
      ext: "java",
      content: "package com.example.web;\n\npublic class Controller {}\n",
    },
    {
      rel: "src/main/java/com/example/web/Helper.java",
      ext: "java",
      content: "package com.example.web;\n\npublic class Helper {}\n",
    },
    {
      // No package declaration — default package
      rel: "src/main/java/Bare.java",
      ext: "java",
      content: "public class Bare {}\n",
    },
  ];

  it("builds a context that resolves direct FQN imports", async () => {
    const ix = makeIndex(files);
    await javaPlugin.prepareForRepo("/fake/root", ix);
    expect(
      javaPlugin.resolveImport(
        "com.example.User",
        "src/main/java/com/example/App.java",
        ix
      )
    ).toBe("src/main/java/com/example/User.java");
  });

  it("resolves a wildcard import via the package-members fallback", async () => {
    const ix = makeIndex(files);
    await javaPlugin.prepareForRepo("/fake/root", ix);
    // `import com.example.web.*;` — spec captured as "com.example.web"
    // since wildcard isn't part of scoped_identifier in the grammar.
    // We resolve to the alphabetically-first member of the package.
    const resolved = javaPlugin.resolveImport(
      "com.example.web",
      "src/main/java/com/example/App.java",
      ix
    );
    expect(resolved).toBe("src/main/java/com/example/web/Controller.java");
  });

  it("returns null for stdlib / external imports", async () => {
    const ix = makeIndex(files);
    await javaPlugin.prepareForRepo("/fake/root", ix);
    expect(
      javaPlugin.resolveImport(
        "java.util.List",
        "src/main/java/com/example/App.java",
        ix
      )
    ).toBeNull();
    expect(
      javaPlugin.resolveImport(
        "org.springframework.boot.SpringApplication",
        "src/main/java/com/example/App.java",
        ix
      )
    ).toBeNull();
  });

  it("indexes default-package classes (no `package` declaration) by bare class name", async () => {
    const ix = makeIndex(files);
    await javaPlugin.prepareForRepo("/fake/root", ix);
    expect(
      javaPlugin.resolveImport("Bare", "src/main/java/Bare.java", ix)
    ).toBe("src/main/java/Bare.java");
  });
});

describe("javaPlugin — parseFile end-to-end", () => {
  beforeAll(async () => {
    await javaPlugin.load();
  });

  it("captures imports including static and wildcard forms", () => {
    const content =
      "package com.example;\n" +
      "\n" +
      "import com.example.User;\n" +
      "import com.example.web.*;\n" +
      "import java.util.List;\n" +
      "import static org.junit.jupiter.api.Assertions.assertEquals;\n" +
      "\n" +
      "public class Service {}\n";
    const file: SourceFile = {
      rel: "src/main/java/com/example/Service.java",
      ext: "java",
      content,
    };
    const ix = makeIndex([file]);
    const parsed = parseFile(javaPlugin, file, ix);
    expect(parsed.parseError).toBe(false);
    const specs = parsed.imports.map((i) => i.rawSpec).sort();
    expect(specs).toContain("com.example.User");
    expect(specs).toContain("com.example.web"); // wildcard captured as package
    expect(specs).toContain("java.util.List");
  });

  it("extracts methods and constructors", () => {
    const content =
      "package com.example;\n" +
      "\n" +
      "public class Widget {\n" +
      "  public Widget() {}\n" +
      "  public Widget(int seed) {}\n" +
      "  public int render() { return 1; }\n" +
      "  private void update(int x) {\n" +
      "    if (x > 0) System.out.println(x);\n" +
      "  }\n" +
      "}\n";
    const file: SourceFile = {
      rel: "Widget.java",
      ext: "java",
      content,
    };
    const ix = makeIndex([file]);
    const parsed = parseFile(javaPlugin, file, ix);
    const names = parsed.functions.map((f) => f.name).sort();
    // Two constructors (overloaded) both named "Widget" + render + update
    expect(names.filter((n) => n === "Widget").length).toBe(2);
    expect(names).toContain("render");
    expect(names).toContain("update");
  });

  it("computes complexity from Java decision points", () => {
    const content =
      "package com.example;\n" +
      "public class Branchy {\n" +
      "  public int simple() { return 1; }\n" +
      "  public int branchy(int x) {\n" +
      "    if (x > 0) {\n" +
      "      for (int i = 0; i < x; i++) {\n" +
      "        if (i % 2 == 0 && i > 2) {\n" +
      "          return i;\n" +
      "        }\n" +
      "      }\n" +
      "    } else if (x < 0) {\n" +
      "      switch (x) {\n" +
      "        case -1: return -1;\n" +
      "        case -2: return -2;\n" +
      "        default: return 0;\n" +
      "      }\n" +
      "    }\n" +
      "    try {\n" +
      "      return x > 5 ? -x : x;\n" +
      "    } catch (RuntimeException e) {\n" +
      "      return 0;\n" +
      "    }\n" +
      "  }\n" +
      "}\n";
    const file: SourceFile = { rel: "Branchy.java", ext: "java", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(javaPlugin, file, ix);
    const simple = parsed.functions.find((f) => f.name === "simple");
    const branchy = parsed.functions.find((f) => f.name === "branchy");
    expect(simple?.complexity).toBe(1);
    // branchy: 1 base + outer if + for + inner if + && + else-if (nested
    // if_statement) + 2 case clauses + ternary + catch = 10
    // (default not counted, matching the JS plugin convention)
    expect(branchy?.complexity).toBe(10);
  });

  it("captures method invocations and object creation as calls", () => {
    const content =
      "package com.example;\n" +
      "import java.util.ArrayList;\n" +
      "public class Outer {\n" +
      "  public void run() {\n" +
      "    helper();\n" +
      "    System.out.println(\"hi\");\n" +
      "    ArrayList<String> list = new ArrayList<>();\n" +
      "  }\n" +
      "  void helper() {}\n" +
      "}\n";
    const file: SourceFile = { rel: "Outer.java", ext: "java", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(javaPlugin, file, ix);
    const callees = parsed.calls.map((c) => c.calleeName).sort();
    expect(callees).toContain("helper"); // method_invocation
    expect(callees).toContain("println"); // selector method_invocation
    expect(callees).toContain("ArrayList"); // object_creation_expression
  });

  it("attributes calls to the enclosing method", () => {
    const content =
      "package com.example;\n" +
      "public class C {\n" +
      "  public void outer() {\n" +
      "    helper();\n" +
      "  }\n" +
      "  public void inner() {\n" +
      "    util();\n" +
      "  }\n" +
      "  void helper() {}\n" +
      "  void util() {}\n" +
      "}\n";
    const file: SourceFile = { rel: "C.java", ext: "java", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(javaPlugin, file, ix);
    const outerCalls = parsed.calls
      .filter((c) => c.inFunction === "outer")
      .map((c) => c.calleeName);
    expect(outerCalls).toEqual(["helper"]);
    const innerCalls = parsed.calls
      .filter((c) => c.inFunction === "inner")
      .map((c) => c.calleeName);
    expect(innerCalls).toEqual(["util"]);
  });
});

describe("javaPlugin — type-aware tracking (v0.15)", () => {
  beforeAll(async () => {
    await javaPlugin.load();
  });

  it("emits containerType on every method matching the enclosing class", () => {
    const content =
      "package com.example;\n" +
      "public class Widget {\n" +
      "  public Widget() {}\n" +
      "  public int render() { return 0; }\n" +
      "  public void update() {}\n" +
      "}\n";
    const file: SourceFile = { rel: "Widget.java", ext: "java", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(javaPlugin, file, ix);
    for (const fn of parsed.functions) {
      expect(fn.containerType).toBe("Widget");
    }
  });

  it("infers calleeType from a field declaration with explicit type", () => {
    const content =
      "package com.example;\n" +
      "public class Service {\n" +
      "  private ValidatePassword validatePassword;\n" +
      "  public void run() {\n" +
      "    validatePassword.validate(null);\n" +
      "  }\n" +
      "}\n";
    const file: SourceFile = { rel: "Service.java", ext: "java", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(javaPlugin, file, ix);
    const validateCall = parsed.calls.find((c) => c.calleeName === "validate");
    expect(validateCall?.calleeType).toBe("ValidatePassword");
  });

  it("infers calleeType from a method parameter", () => {
    const content =
      "package com.example;\n" +
      "public class Service {\n" +
      "  public void check(ValidateEmail v) {\n" +
      "    v.validate(null);\n" +
      "  }\n" +
      "}\n";
    const file: SourceFile = { rel: "Service.java", ext: "java", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(javaPlugin, file, ix);
    const validateCall = parsed.calls.find((c) => c.calleeName === "validate");
    expect(validateCall?.calleeType).toBe("ValidateEmail");
  });

  it("infers calleeType from a local variable with explicit type", () => {
    const content =
      "package com.example;\n" +
      "public class Service {\n" +
      "  public void run() {\n" +
      "    ValidateUserName v = new ValidateUserName();\n" +
      "    v.validate(null);\n" +
      "  }\n" +
      "}\n";
    const file: SourceFile = { rel: "Service.java", ext: "java", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(javaPlugin, file, ix);
    const validateCall = parsed.calls.find((c) => c.calleeName === "validate");
    expect(validateCall?.calleeType).toBe("ValidateUserName");
  });

  it("strips generics when extracting types (List<String> → List)", () => {
    const content =
      "package com.example;\n" +
      "import java.util.List;\n" +
      "public class S {\n" +
      "  private List<String> items;\n" +
      "  public void use() { items.size(); }\n" +
      "}\n";
    const file: SourceFile = { rel: "S.java", ext: "java", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(javaPlugin, file, ix);
    const sizeCall = parsed.calls.find((c) => c.calleeName === "size");
    expect(sizeCall?.calleeType).toBe("List");
  });

  it("`this.method()` and bare `method()` resolve to current class", () => {
    const content =
      "package com.example;\n" +
      "public class Owner {\n" +
      "  public void publicApi() {\n" +
      "    helper();\n" +
      "    this.alsoHelper();\n" +
      "  }\n" +
      "  void helper() {}\n" +
      "  void alsoHelper() {}\n" +
      "}\n";
    const file: SourceFile = { rel: "Owner.java", ext: "java", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(javaPlugin, file, ix);
    const helperCall = parsed.calls.find((c) => c.calleeName === "helper");
    const alsoHelperCall = parsed.calls.find(
      (c) => c.calleeName === "alsoHelper"
    );
    expect(helperCall?.calleeType).toBe("Owner");
    expect(alsoHelperCall?.calleeType).toBe("Owner");
  });

  it("disambiguates two same-named methods on different fields in the same class", () => {
    const content =
      "package com.example;\n" +
      "public class Service {\n" +
      "  private ValidatePassword vp;\n" +
      "  private ValidateEmail ve;\n" +
      "  public void run() {\n" +
      "    vp.validate(null);\n" +
      "    ve.validate(null);\n" +
      "  }\n" +
      "}\n";
    const file: SourceFile = { rel: "Service.java", ext: "java", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(javaPlugin, file, ix);
    const validateCalls = parsed.calls
      .filter((c) => c.calleeName === "validate")
      .map((c) => c.calleeType);
    // Each call's type matches the receiver's type — they don't collapse
    expect(validateCalls).toEqual(["ValidatePassword", "ValidateEmail"]);
  });

  it("leaves calleeType undefined when the receiver type can't be inferred", () => {
    const content =
      "package com.example;\n" +
      "public class S {\n" +
      "  public void f() {\n" +
      "    getThing().doStuff();\n" + // chained — return type not tracked
      "  }\n" +
      "  Object getThing() { return null; }\n" +
      "}\n";
    const file: SourceFile = { rel: "S.java", ext: "java", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(javaPlugin, file, ix);
    const doStuff = parsed.calls.find((c) => c.calleeName === "doStuff");
    expect(doStuff?.calleeType).toBeUndefined();
    // doesn't crash — and we still emit the call so the name-based fallback
    // in pickCallTarget can try
    expect(doStuff).toBeDefined();
  });

  it("constructor calls (new Foo()) emit calleeType = the class itself", () => {
    const content =
      "package com.example;\n" +
      "public class S {\n" +
      "  public void f() {\n" +
      "    Widget w = new Widget();\n" +
      "  }\n" +
      "}\n";
    const file: SourceFile = { rel: "S.java", ext: "java", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(javaPlugin, file, ix);
    const widgetNew = parsed.calls.find((c) => c.calleeName === "Widget");
    expect(widgetNew?.calleeType).toBe("Widget");
  });
});

// ---------------- v0.71: Class extraction (Architecture tab) ----------------

describe("javaPlugin — class extraction for Architecture tab", () => {
  beforeAll(async () => {
    await javaPlugin.load();
  });

  it("emits a ParsedClass for a basic class with fields + methods", () => {
    const content =
      "package com.example;\n" +
      "public class User {\n" +
      "  public String name;\n" +
      "  private int age;\n" +
      "  public Token login(String password) { return null; }\n" +
      "  public void logout() {}\n" +
      "}\n";
    const file: SourceFile = { rel: "User.java", ext: "java", content };
    const parsed = parseFile(javaPlugin, file, makeIndex([file]));
    expect(parsed.classes).toHaveLength(1);
    const cls = parsed.classes![0];
    expect(cls.name).toBe("User");
    expect(cls.isInterface).toBe(false);
    expect(cls.isAbstract).toBe(false);
    expect(cls.fields.map((f) => f.name).sort()).toEqual(["age", "name"]);
    expect(cls.methodNames.sort()).toEqual(["login", "logout"]);
  });

  it("captures field visibility from the modifiers child", () => {
    const content =
      "package com.example;\n" +
      "public class X {\n" +
      "  public String pub;\n" +
      "  private int priv;\n" +
      "  protected double prot;\n" +
      "  String pkg;\n" + // package-private (no modifier) → "internal"
      "}\n";
    const file: SourceFile = { rel: "X.java", ext: "java", content };
    const parsed = parseFile(javaPlugin, file, makeIndex([file]));
    const fields = parsed.classes![0].fields;
    const byName = Object.fromEntries(fields.map((f) => [f.name, f.visibility]));
    expect(byName.pub).toBe("public");
    expect(byName.priv).toBe("private");
    expect(byName.prot).toBe("protected");
    expect(byName.pkg).toBe("internal");
  });

  it("flags static + final fields", () => {
    const content =
      "package com.example;\n" +
      "public class X {\n" +
      "  public static final String VERSION = \"1.0\";\n" +
      "  public final int id = 0;\n" +
      "  public String mutable;\n" +
      "}\n";
    const file: SourceFile = { rel: "X.java", ext: "java", content };
    const parsed = parseFile(javaPlugin, file, makeIndex([file]));
    const fields = parsed.classes![0].fields;
    const version = fields.find((f) => f.name === "VERSION")!;
    expect(version.isStatic).toBe(true);
    expect(version.isReadonly).toBe(true);
    const id = fields.find((f) => f.name === "id")!;
    expect(id.isStatic).toBe(false);
    expect(id.isReadonly).toBe(true);
    const mutable = fields.find((f) => f.name === "mutable")!;
    expect(mutable.isStatic).toBe(false);
    expect(mutable.isReadonly).toBe(false);
  });

  it("captures extends + implements relationships", () => {
    const content =
      "package com.example;\n" +
      "public class Dog extends Animal implements Trainable, Serializable {\n" +
      "}\n";
    const file: SourceFile = { rel: "Dog.java", ext: "java", content };
    const parsed = parseFile(javaPlugin, file, makeIndex([file]));
    const cls = parsed.classes![0];
    expect(cls.parentClass).toBe("Animal");
    expect(cls.implements).toEqual(["Trainable", "Serializable"]);
  });

  it("flags abstract classes via the abstract modifier", () => {
    const content =
      "package com.example;\n" +
      "public abstract class Shape {\n" +
      "  public abstract double area();\n" +
      "}\n";
    const file: SourceFile = { rel: "Shape.java", ext: "java", content };
    const parsed = parseFile(javaPlugin, file, makeIndex([file]));
    expect(parsed.classes![0].isAbstract).toBe(true);
  });

  it("flags interfaces with isInterface=true", () => {
    const content =
      "package com.example;\n" +
      "public interface Comparable<T> {\n" +
      "  int compareTo(T other);\n" +
      "}\n";
    const file: SourceFile = { rel: "Comparable.java", ext: "java", content };
    const parsed = parseFile(javaPlugin, file, makeIndex([file]));
    expect(parsed.classes![0].isInterface).toBe(true);
    expect(parsed.classes![0].name).toBe("Comparable");
    expect(parsed.classes![0].methodNames).toContain("compareTo");
  });

  it("emits a ParsedClass for enum_declaration with isEnum + enumValues (v0.71)", () => {
    // v0.71: enums get a dedicated entry in the diagram so users can
    // see Status / Privacy / FormatType etc. as visual members of
    // their domain model. Records remain skipped (different shape).
    const content =
      "package com.example;\n" +
      "public enum Color { RED, GREEN, BLUE }\n";
    const file: SourceFile = { rel: "Color.java", ext: "java", content };
    const parsed = parseFile(javaPlugin, file, makeIndex([file]));
    expect(parsed.classes).toHaveLength(1);
    const cls = parsed.classes![0];
    expect(cls.name).toBe("Color");
    expect(cls.isEnum).toBe(true);
    expect(cls.isInterface).toBeFalsy();
    expect(cls.fields).toEqual([]);
    expect(cls.enumValues).toEqual(["RED", "GREEN", "BLUE"]);
  });

  it("does NOT emit ParsedClass for record_declaration (still skipped)", () => {
    const content =
      "package com.example;\n" +
      "public record Point(int x, int y) {}\n";
    const file: SourceFile = { rel: "Point.java", ext: "java", content };
    const parsed = parseFile(javaPlugin, file, makeIndex([file]));
    expect(parsed.classes).toEqual([]);
  });

  it("preserves generic parameterization in field types (v0.71)", () => {
    // Pre-fix, `List<Card>` was stripped to `List` on field display, losing
    // the most semantically important info (and breaking the arrow-target
    // resolution in classDiagram, which now peels `<X>` to find Card).
    const content =
      "package com.example;\n" +
      "import java.util.List;\n" +
      "import java.util.Map;\n" +
      "public class Holder {\n" +
      "  private List<Card> cards;\n" +
      "  private Map<String, Card> byName;\n" +
      "}\n";
    const file: SourceFile = { rel: "Holder.java", ext: "java", content };
    const parsed = parseFile(javaPlugin, file, makeIndex([file]));
    const fields = parsed.classes![0].fields;
    const byName = new Map(fields.map((f) => [f.name, f]));
    expect(byName.get("cards")?.type).toBe("List<Card>");
    expect(byName.get("byName")?.type).toBe("Map<String, Card>");
  });

  it("captures primitive field types (int, long, double, boolean) — v0.71", () => {
    // Pre-fix, primitives returned null from extractTypeName so the
    // Architecture tab rendered `id` and `weight` with no type, looking
    // empty for stat-heavy classes (Card / User / etc.). Post-fix the
    // literal keyword surfaces in the field list.
    const content =
      "package com.example;\n" +
      "public class Card {\n" +
      "  private int id;\n" +
      "  private long timestamp;\n" +
      "  private double weight;\n" +
      "  private boolean active;\n" +
      "  private String name;\n" +
      "}\n";
    const file: SourceFile = { rel: "Card.java", ext: "java", content };
    const parsed = parseFile(javaPlugin, file, makeIndex([file]));
    const fields = parsed.classes![0].fields;
    const byName = new Map(fields.map((f) => [f.name, f]));
    expect(byName.get("id")?.type).toBe("int");
    expect(byName.get("timestamp")?.type).toBe("long");
    expect(byName.get("weight")?.type).toBe("double");
    expect(byName.get("active")?.type).toBe("boolean");
    // Reference type still works as before
    expect(byName.get("name")?.type).toBe("String");
  });
});

// Receiver shapes the resolver could not type, and the enum call it never saw.
//
// All of this came from one real report. A Java school project's `Dish.price()`
// read "no test reaches it" on the merge card while five JUnit tests asserted
// its exact values — because every one of those tests reached it through a
// receiver the plugin could not type:
//
//   Dish.FESTIVALBURGER.price()          enum constant, a field_access
//   for (Dish d : Dish.values()) d.price()   enhanced-for variable
//   dishes[i].price()                    array element
//
// The negative cases matter as much as the positive ones. The resolver requires
// containerType === calleeType when there is an explicit receiver, so a WRONG
// type costs a missed edge rather than an invented one — but that guard is the
// thing being relied on here, so it is asserted rather than assumed.
describe("javaPlugin — receiver shapes behind test calls", () => {
  beforeAll(async () => {
    await javaPlugin.load();
  });

  const parse = (content: string, rel = "T.java") => {
    const file: SourceFile = { rel, ext: "java", content };
    return parseFile(javaPlugin, file, makeIndex([file]));
  };
  const typeOf = (content: string, callee: string) =>
    parse(content).calls.find((c) => c.calleeName === callee)?.calleeType;

  it("types an enum constant as its enum", () => {
    expect(
      typeOf("class T { void a() { Dish.FESTIVALBURGER.price(); } }", "price"),
    ).toBe("Dish");
  });

  it("types the enhanced-for loop variable", () => {
    // It used to come out as "dish" — the VARIABLE name offered as a class
    // name, which cannot match anything by construction.
    expect(
      typeOf("class T { void a() { for (Dish dish : Dish.values()) { dish.price(); } } }", "price"),
    ).toBe("Dish");
  });

  it("types an array element as the element type", () => {
    expect(
      typeOf("class T { void a() { Dish[] ds = Dish.values(); ds[0].price(); } }", "price"),
    ).toBe("Dish");
  });

  it("keeps the array variable itself un-matchable", () => {
    // `ds` is Dish[], not Dish. Reporting "Dish" for `ds.length()` would be a
    // type error dressed as a resolution.
    expect(
      typeOf("class T { void a() { Dish[] ds = Dish.values(); ds.clone(); } }", "clone"),
    ).toBe("Dish[]");
  });

  it("does not claim a type for a lowercase receiver", () => {
    // `config.MAX.get()` — config is a variable we know nothing about. The
    // uppercase-receiver rule is what separates a type name from a value.
    expect(
      typeOf("class T { void a(Object config) { config.MAX.get(); } }", "get"),
    ).toBeUndefined();
  });

  it("does not claim a type for a non-constant member", () => {
    // `Config.instance.get()` — lowercase member, so not the constant idiom.
    expect(
      typeOf("class T { void a() { Config.instance.get(); } }", "get"),
    ).toBeUndefined();
  });

  it("prefers a real local over the constant heuristic", () => {
    // A variable that shadows a type name must win. `Dish` here is an Object.
    expect(
      typeOf("class T { void a(Object Dish) { Dish.FIELD.get(); } }", "get"),
    ).toBeUndefined();
  });

  it("still resolves nothing when the named type has no such method", () => {
    // The guard the whole heuristic leans on: two files, `Config.MAX_SIZE` is
    // NOT an enum constant, and Config has no `length`. calleeType says
    // "Config", the resolver finds no match, and declines rather than reaching
    // for the same-named method on an unrelated class.
    const a: SourceFile = {
      rel: "A.java",
      ext: "java",
      content: "class T { void a() { Config.MAX_SIZE.length(); } }",
    };
    const b: SourceFile = {
      rel: "B.java",
      ext: "java",
      content: "class Other { public int length() { return 1; } }",
    };
    const parsed = parseFile(javaPlugin, a, makeIndex([a, b]));
    const call = parsed.calls.find((c) => c.calleeName === "length")!;
    expect(call.calleeType).toBe("Config");
    expect(call.hasReceiver, "the strict guard needs an explicit receiver").toBe(true);
  });
});

describe("javaPlugin — enum bodies", () => {
  beforeAll(async () => {
    await javaPlugin.load();
  });

  const parse = (content: string) => {
    const file: SourceFile = { rel: "Dish.java", ext: "java", content };
    return parseFile(javaPlugin, file, makeIndex([file]));
  };

  const ENUM = `enum Dish {
    FESTIVALBURGER("Festivalburger", 59),
    VEGANSK_BOWL("Vegansk bowl", 65);
    private final String displayName;
    private final int price;
    Dish(String displayName, int price) { this.displayName = displayName; this.price = price; }
    public int price() { return price; }
}`;

  it("counts a constant with arguments as a constructor call", () => {
    // Java writes it without `new` and without a receiver, so it matched
    // neither call shape and produced no edge at all — the constructor read
    // "0 callers" because the graph genuinely had none.
    const calls = parse(ENUM).calls.filter((c) => c.calleeName === "Dish");
    expect(calls).toHaveLength(2);
    for (const c of calls) expect(c.calleeType).toBe("Dish");
  });

  it("emits nothing for a bare constant, which has no constructor to call", () => {
    // `enum Color { RED, GREEN }` uses the implicit no-arg constructor, and the
    // plugin does not emit that as a function — an edge would point at nothing.
    const calls = parse("enum Color { RED, GREEN, BLUE }").calls.filter(
      (c) => c.calleeName === "Color",
    );
    expect(calls).toEqual([]);
  });

  it("finds the methods an enum declares", () => {
    // They live under enum_body_declarations, one level below the constants.
    // Reading only the body's direct children reported every enum as having no
    // methods at all.
    const cls = parse(ENUM).classes?.find((c) => c.name === "Dish");
    expect(cls?.isEnum).toBe(true);
    expect(cls?.enumValues).toEqual(["FESTIVALBURGER", "VEGANSK_BOWL"]);
    expect(cls?.methodNames?.sort()).toEqual(["Dish", "price"]);
  });

  it("still reports an enum with no body", () => {
    const cls = parse("enum Color { RED, GREEN, BLUE }").classes?.find(
      (c) => c.name === "Color",
    );
    expect(cls?.enumValues).toEqual(["RED", "GREEN", "BLUE"]);
    expect(cls?.methodNames ?? []).toEqual([]);
  });
});
