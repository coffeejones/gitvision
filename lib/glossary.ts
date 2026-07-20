// Plain-language glossary — the single source of truth for "what this means"
// microcopy across the workspace. Rick Segal's feedback: developers don't
// intuit terms like "untested hotspot" or "file complexity", and more
// importantly don't grasp the DOWNSTREAM impact ("what it could mean later if
// you build on this repo"). Every entry therefore carries both:
//   what — one line: what the number/term actually measures
//   why  — one line: why it matters for someone reading or reusing the code
// This is the landing promise ("read it like a manual") made true inside the
// product. `anchor` deep-links to the fuller explanation on /help.
//
// Voice: plain, concrete, second-person where natural, no hedging. These
// strings are user-facing microcopy — keep them short enough to sit in a
// popover or a one-line caption.

export interface GlossaryEntry {
  /** Canonical display term. */
  term: string;
  /** What it measures — one line. */
  what: string;
  /** Why it matters downstream — one line. */
  why: string;
  /** Section id on /help for "read more", when one exists. */
  anchor?: string;
}

export const GLOSSARY = {
  "file-complexity": {
    term: "File complexity",
    what: "The number of independent paths through a file's code — McCabe cyclomatic complexity, summed across its functions.",
    why: "The higher it is, the more branches you have to hold in your head to change it safely — and the more places a change can go wrong.",
    anchor: "code-panel",
  },
  complexity: {
    term: "Complexity",
    what: "McCabe cyclomatic complexity: the count of independent paths through a function.",
    why: "A high number means lots of branching — harder to test fully and easier to break when you change it.",
    anchor: "code-panel",
  },
  "untested-hotspot": {
    term: "Untested hotspot",
    what: "A function that is both complex and has no test calling it directly.",
    why: "The riskiest kind of code to change: a real chance of breaking something, and no test standing guard to catch it.",
    anchor: "untested-duplicates",
  },
  coverage: {
    term: "Test coverage",
    what: "How many of a file's functions have a test that calls them (tested / total).",
    why: "Low coverage on complex, frequently-changed code is exactly where regressions slip in unnoticed.",
    anchor: "untested-duplicates",
  },
  "blast-radius": {
    term: "Blast radius",
    what: "Every file and function that depends on this one, traced out a few hops.",
    why: "It's what a change here could break downstream — visible before you make the change, not after CI fails.",
    anchor: "blast-radius",
  },
  "bus-factor": {
    term: "Bus factor",
    what: "How few people would have to leave before knowledge of a part of the code walks out the door.",
    why: "A bus factor of one means a single person holds that corner — a real risk if you're depending on this repo and they move on.",
  },
  churn: {
    term: "Churn",
    what: "How often a file has changed across its full git history.",
    why: "High churn on complex code marks friction — the parts the team keeps fighting with, and the parts most likely to keep changing under you.",
  },
  "fan-in": {
    term: "Fan-in",
    what: "How many other functions call this one.",
    why: "High fan-in means many callers lean on it — change its behavior and the effect ripples widely.",
    anchor: "blast-radius",
  },
  "fan-out": {
    term: "Fan-out",
    what: "How many other functions this one calls.",
    why: "High fan-out means it leans on many things — more to understand before you touch it.",
    anchor: "blast-radius",
  },
  "call-resolution": {
    term: "Call resolution",
    what: "The share of call sites we could pin to a specific target definition.",
    why: "Dynamic dispatch can't always be resolved from static code, so the call graph is high-confidence but not exhaustive — coverage is lower on dynamic languages.",
    anchor: "code-panel",
  },
  "near-duplicate": {
    term: "Near-duplicate",
    what: "Functions with structurally identical bodies (matched by AST shape), copy-pasted across the repo.",
    why: "A bug fixed in one copy usually has to be fixed in all of them — a quiet maintenance trap.",
    anchor: "untested-duplicates",
  },
  "import-depth": {
    term: "Import depth",
    what: "The longest chain of file-to-file imports in the repo.",
    why: "A change near the top of a deep chain ripples down through every step below it.",
    anchor: "imports",
  },
  "cross-boundary": {
    term: "Cross-boundary coupling",
    what: "Functions that reach across module or folder boundaries a lot.",
    why: "Tightly coupled modules are harder to change, test, or lift out on their own.",
    anchor: "architecture",
  },
  "co-change": {
    term: "Co-change",
    what: "Files that keep changing together in the same commits, even when neither imports the other.",
    why: "Hidden coupling — change one and you'll probably have to change its partner, which import graphs alone won't warn you about.",
  },
  "load-bearing": {
    term: "Load-bearing file",
    what: "A file that many others depend on — deleting or breaking it cascades widely.",
    why: "The kind of file where a careless change takes down features far from where you touched.",
    anchor: "blast-radius",
  },
  "hollow-test": {
    term: "Hollow test",
    what: "A test case that runs code but asserts nothing meaningful about the result.",
    why: "It goes green whether the code is right or wrong — coverage that gives false confidence.",
    anchor: "testquality",
  },
  "assertion-density": {
    term: "Assertion density",
    what: "The average number of meaningful assertions per test case.",
    why: "Low density means the suite mostly checks that code runs, not that it's correct.",
    anchor: "testquality",
  },
  "time-to-merge": {
    term: "Time to merge",
    what: "How long a pull request stayed open before it was merged.",
    why: "Consistently slow times can signal heavy review, blocked work, or an overloaded team.",
  },
  cve: {
    term: "CVE",
    what: "A publicly catalogued security vulnerability (Common Vulnerabilities and Exposures).",
    why: "A dependency with an open CVE is a known way in — worth patching before you build on it.",
    anchor: "dep-health",
  },
  sbom: {
    term: "SBOM",
    what: "A software bill of materials — the full inventory of packages this repo pulls in.",
    why: "It's what you'd hand an auditor, or check before trusting someone else's dependency tree.",
    anchor: "dep-health",
  },
  "dynamic-execution": {
    term: "Dynamic execution",
    what: "Code that runs strings as code at runtime — eval, exec, new Function.",
    why: "If any of that input is attacker-influenced, it's remote code execution waiting to happen.",
    anchor: "code-panel",
  },
  "regex-fallback": {
    term: "Regex fallback",
    what: "Languages we don't fully parse yet, read with regular expressions for imports only.",
    why: "You still get the dependency graph, but not functions, calls, or complexity for those files.",
    anchor: "code-panel",
  },
} satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;

export function glossary(key: GlossaryKey): GlossaryEntry {
  return GLOSSARY[key];
}
