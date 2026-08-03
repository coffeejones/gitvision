// Why do receiver calls not resolve? Split them by cause, so the next fix
// aims at the biggest real one instead of the most obvious-looking one.
import { ALL_PLUGINS } from "../lib/codeAnalysis/plugins/all";
import { analyzeDirectory } from "../lib/codeAnalysis/analyze";

(async () => {
  const root = process.argv[2];
  const { codeGraph: cg } = await analyzeDirectory(root, ALL_PLUGINS);
  const ownMethods = new Map<string, Set<string>>(); // name -> containerTypes
  const ownTop = new Set<string>();
  const classNames = new Set<string>();
  for (const f of cg.functions) {
    if (f.containerType) {
      classNames.add(f.containerType);
      const s = ownMethods.get(f.name) ?? new Set(); s.add(f.containerType); ownMethods.set(f.name, s);
    } else ownTop.add(f.name);
  }
  const importsByFile = new Map<string, Set<string>>();
  for (const e of cg.imports) {
    const s = importsByFile.get(e.from) ?? new Set<string>(); if (e.to) s.add(e.to);
    importsByFile.set(e.from, s);
  }
  const moduleNames = new Map<string, Set<string>>(); // file -> importable names it imports
  for (const [f, targets] of importsByFile) {
    const s = new Set<string>();
    for (const t of targets) {
      const base = t.slice(t.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
      s.add(base === "__init__" ? t.slice(0, t.lastIndexOf("/")).split("/").pop()! : base);
    }
    moduleNames.set(f, s);
  }

  const scope = process.argv[3] ?? "tests/";
  const recv = cg.calls.filter((c) => c.fromFile.startsWith(scope) && c.calleeType);
  const buckets = new Map<string, number>();
  const samples = new Map<string, string[]>();
  const bump = (k: string, s: string) => {
    buckets.set(k, (buckets.get(k) ?? 0) + 1);
    const a = samples.get(k) ?? []; if (a.length < 3) a.push(s); samples.set(k, a);
  };

  for (const c of recv) {
    if (c.toFile) { bump("RESOLVED", ""); continue; }
    const t = c.calleeType!;
    const label = `${t}.${c.calleeName}()`;
    const knownMethod = ownMethods.has(c.calleeName);
    const knownTop = ownTop.has(c.calleeName);
    if (t === "self") bump("receiver is `self`", label);
    else if (moduleNames.get(c.fromFile)?.has(t)) bump("receiver is a MODULE we import (should resolve)", label);
    else if (classNames.has(t)) bump("receiver names a CLASS we define", label);
    else if (knownMethod) bump("local var; callee IS a method we define (needs local type inference)", label);
    else if (knownTop) bump("local var; callee is a top-level fn we define", label);
    else bump("callee unknown to the graph — external, correct to decline", label);
  }
  const total = recv.length;
  console.log(`receiver calls from ${scope} in ${root.split("/").pop()}: ${total}\n`);
  for (const [k, n] of [...buckets.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${String(Math.round(n * 100 / total)).padStart(3)}%  ${k}`);
    for (const s of samples.get(k) ?? []) if (s) console.log(`                  e.g. ${s}`);
  }
})();
