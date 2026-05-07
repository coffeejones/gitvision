"use client";

// Code tab — surfaces the v0.10 codeAnalysis pipeline output.
//
// Hero view is blast radius. Two modes share the same hero slot:
//   - File mode (default): which files break if THIS file changes (incoming),
//     which files this file depends on (outgoing).
//   - Function mode (after clicking a function chip or a top-functions item):
//     which functions call THIS function (callers), which functions THIS
//     function calls (callees). Click "Back to file" to return.
//
// Function mode requires resolved call edges from a Phase 5+ plugin (JS/TS,
// Java, Go, Python). For files only covered by the regex-fallback plugin,
// the function chips simply won't have call edges — the function view will
// show empty lists, which is the honest outcome.
//
// Coverage chip at top makes our limits explicit: JS/TS gets full call-graph
// + complexity, the other 7 languages contribute imports only via the
// regex-fallback plugin. Honest accounting beats over-promised UI.

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  ChevronDown,
  ChevronRight,
  Code as CodeIcon,
  FileCode,
  Copy,
  FlaskConical,
  PhoneIncoming,
  PhoneOutgoing,
  ShieldOff,
  Sparkles,
  Target,
} from "lucide-react";
import type { AnalysisSnapshot, CodeGraph } from "@/lib/types";
import { STYLE, TOK } from "@/lib/theme";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { HelpHint } from "@/components/HelpHint";
import { SearchInput } from "@/components/SearchInput";
import {
  computeBlastRadius,
  computeFunctionBlastRadius,
  type BlastRadius,
  type FunctionBlastRadius,
} from "@/lib/codeAnalysis/blastRadius";
import {
  computeTestCoverage,
  type TestCoverage,
} from "@/lib/codeAnalysis/testCoverage";
import {
  findDuplicateGroups,
  summarizeDuplicates,
  type DuplicateGroup,
} from "@/lib/codeAnalysis/duplicates";

const INITIAL_LIST_SIZE = 10;
const EXPANDED_LIST_SIZE = 60;

/** Persisted boolean state for "is this panel expanded". Default-expanded
 *  matches what the server-rendered HTML shows, so there's no hydration
 *  mismatch. Returning visitors who collapsed a panel get a brief flash of
 *  the expanded state on first paint, then it collapses to their preference
 *  once the effect runs. Acceptable because:
 *    1. The Code tab is below the fold of the hero blast-radius card —
 *       by the time you scroll there, the effect has fired.
 *    2. The flash signals "panel exists" which is good discovery.
 *    3. localStorage isolation per panel (each panel has its own key)
 *       means toggling one doesn't affect the other. */
function usePanelExpansion(
  storageKey: string
): [boolean, () => void] {
  const [isExpanded, setIsExpanded] = useState(true);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === "false") setIsExpanded(false);
    } catch {
      // localStorage can throw in private mode / cross-origin frames.
      // Falling back to the default-expanded state is the right move.
    }
  }, [storageKey]);
  function toggle() {
    setIsExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey, String(next));
      } catch {
        /* see comment above */
      }
      return next;
    });
  }
  return [isExpanded, toggle];
}

export function CodePanel({ snapshot }: { snapshot: AnalysisSnapshot }) {
  const cg = snapshot.codeGraph;
  if (!cg) return <EmptyState reason={snapshot.codeGraphSkipReason} />;
  return <CodePanelInner cg={cg} />;
}

// ------------------- Inner panel -------------------

function CodePanelInner({ cg }: { cg: CodeGraph }) {
  const searchParams = useSearchParams();

  // Files sorted by fileComplexity desc — the "real heavy" filter.
  // We deliberately don't sort by function count because tests inflate that
  // (one it() = one function), which we saw on Vue: apiOptions.spec.ts has
  // 195 "functions" but file complexity 2.
  const heavyFiles = useMemo(() => {
    return Object.entries(cg.fileComplexity)
      .map(([file, complexity]) => ({ file, complexity }))
      .sort((a, b) => b.complexity - a.complexity);
  }, [cg.fileComplexity]);

  const allFiles = useMemo(
    () => Object.keys(cg.fileComplexity).sort(),
    [cg.fileComplexity]
  );

  const topFunctions = useMemo(() => {
    return [...cg.functions]
      .sort((a, b) => b.complexity - a.complexity)
      .slice(0, 30);
  }, [cg.functions]);

  // Default: heaviest file in the codebase. Empty state is boring; opening on
  // top-complex-file lands the user where the most interesting blast radius
  // lives. Deep-link `?file=...` overrides this on mount (effect below);
  // localStorage selection (v0.46) is the second-line fallback so a user's
  // previous selection persists across tab navigation in the workspace.
  const [selected, setSelected] = useState<string | null>(
    heavyFiles[0]?.file ?? null
  );
  // Function-level zoom. null = file-level blast radius, set = function mode.
  // Tied to `selected` (the file): switching files clears the function.
  // Functions are identified by (file, name, containerType?) since v0.28 —
  // overloads with the same name in different classes (e.g. Blueprint.__init__
  // vs BlueprintSetupState.__init__) are now distinct selections.
  const [selectedFunction, setSelectedFunction] = useState<{
    name: string;
    containerType?: string;
  } | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  // v0.46: persist selection across tab navigation. When the user
  // picks a file or function on /code, save it; when they come back
  // to /code from /canvas / /imports / wherever, restore it. Single-
  // session scope — keys aren't per-session-id because the typical
  // user has one session open at a time. Multi-session collision is
  // unfortunate but rare.
  function rememberSelection(
    file: string | null,
    fn: { name: string; containerType?: string } | null
  ) {
    try {
      if (file) {
        localStorage.setItem("gitvision:codepanel:file", file);
      } else {
        localStorage.removeItem("gitvision:codepanel:file");
      }
      if (fn) {
        localStorage.setItem("gitvision:codepanel:fn", fn.name);
        if (fn.containerType) {
          localStorage.setItem("gitvision:codepanel:container", fn.containerType);
        } else {
          localStorage.removeItem("gitvision:codepanel:container");
        }
      } else {
        localStorage.removeItem("gitvision:codepanel:fn");
        localStorage.removeItem("gitvision:codepanel:container");
      }
    } catch {
      /* localStorage unavailable — selection just doesn't persist */
    }
  }

  // v0.37 deep-link + v0.46 localStorage fallback. Priority order:
  //   1. URL search params (someone shared a deep-link)
  //   2. localStorage (you came back to /code from another tab)
  //   3. Default (heaviest file, set by useState above)
  // Applied once on mount only — subsequent in-page navigation
  // shouldn't fight the URL or restore stale state.
  const untestedRef = useRef<HTMLDivElement>(null);
  const duplicatesRef = useRef<HTMLDivElement>(null);
  const blastRadiusRef = useRef<HTMLDivElement>(null);
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (deepLinkApplied.current) return;
    const urlFile = searchParams.get("file");
    const urlFn = searchParams.get("fn");
    const urlContainer = searchParams.get("container") ?? undefined;
    const focus = searchParams.get("focus");

    let file = urlFile;
    let fn = urlFn;
    let container = urlContainer;

    // localStorage fallback when no URL deep-link is present.
    if (!file) {
      try {
        const storedFile = localStorage.getItem("gitvision:codepanel:file");
        const storedFn = localStorage.getItem("gitvision:codepanel:fn");
        const storedContainer = localStorage.getItem(
          "gitvision:codepanel:container"
        );
        if (storedFile) {
          // Only restore if the stored file still exists in this
          // snapshot. A different repo or a refreshed snapshot can
          // make stored selections stale.
          if (cg.fileComplexity[storedFile] !== undefined) {
            file = storedFile;
            fn = storedFn;
            container = storedContainer ?? undefined;
          }
        }
      } catch {
        /* ignore */
      }
    }

    if (file) {
      setSelected(file);
      if (fn) setSelectedFunction({ name: fn, containerType: container });
    }
    // Scroll target — uses requestAnimationFrame to wait for the panels
    // to render with the new selected state before measuring scroll.
    if (focus === "untested" || focus === "duplicates" || focus === "blast") {
      requestAnimationFrame(() => {
        const target =
          focus === "untested"
            ? untestedRef.current
            : focus === "duplicates"
            ? duplicatesRef.current
            : blastRadiusRef.current;
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
    deepLinkApplied.current = true;
  }, [searchParams]);

  const filtered = useMemo(() => {
    if (!deferredQuery) return [] as string[];
    const q = deferredQuery.toLowerCase();
    return allFiles.filter((f) => f.toLowerCase().includes(q)).slice(0, 25);
  }, [allFiles, deferredQuery]);

  const blast = useMemo(() => {
    if (!selected) return null;
    return computeBlastRadius(cg, selected, { maxHops: 3 });
  }, [cg, selected]);

  // v0.29: test-to-code coverage. Pure-function compute — fast enough to
  // recompute on every cg change without memoizing more aggressively.
  const coverage = useMemo(() => computeTestCoverage(cg), [cg]);

  // v0.30: structural duplicate detection. Runs in browser; the heavy
  // lifting (AST hashing) already happened server-side at analysis time.
  const duplicateGroups = useMemo(() => findDuplicateGroups(cg), [cg]);

  const fnBlast = useMemo(() => {
    if (!selected || !selectedFunction) return null;
    return computeFunctionBlastRadius(cg, selected, selectedFunction.name, {
      maxHops: 3,
      targetContainerType: selectedFunction.containerType,
    });
  }, [cg, selected, selectedFunction]);

  const selectedComplexity = selected
    ? cg.fileComplexity[selected] ?? 0
    : null;
  // Functions in the selected file. v0.28 removed the name-dedup workaround
  // that v0.20 introduced — CallEdge.toContainerType now lets us
  // distinguish overloads (Blueprint.__init__ vs BlueprintSetupState.__init__),
  // so showing both chips produces distinct, accurate blast radii.
  const selectedFunctions = useMemo(() => {
    if (!selected) return [];
    return cg.functions
      .filter((f) => f.filePath === selected)
      .map((f) => ({
        name: f.name,
        complexity: f.complexity,
        startRow: f.startRow,
        containerType: f.containerType,
      }))
      .sort((a, b) => b.complexity - a.complexity);
  }, [cg.functions, selected]);

  function pickFile(f: string) {
    setSelected(f);
    setSelectedFunction(null); // reset zoom — different file means different fns
    setQuery("");
    rememberSelection(f, null);
  }

  function pickFunction(
    file: string,
    fnName: string,
    containerType?: string
  ) {
    setSelected(file);
    setSelectedFunction({ name: fnName, containerType });
    setQuery("");
    rememberSelection(file, { name: fnName, containerType });
  }

  return (
    <div className="flex flex-col gap-4">
      <CoverageChip cg={cg} />

      {/* Hero: selected file + blast radius (file mode or function mode) */}
      <div
        ref={blastRadiusRef}
        className="rounded-xl p-5 flex flex-col gap-4"
        style={{
          background: TOK.surface,
          border: `1px solid ${TOK.border}`,
        }}
      >
        <SelectedFileHeader
          selected={selected}
          complexity={selectedComplexity}
          functions={selectedFunctions}
          activeFunction={selectedFunction}
          onSelectFunction={(name, containerType) => {
            if (!selected) return;
            setSelectedFunction({ name, containerType });
            rememberSelection(selected, { name, containerType });
          }}
          query={query}
          onQueryChange={setQuery}
          filtered={filtered}
          onPick={pickFile}
        />

        {selectedFunction && fnBlast ? (
          <FunctionBlastRadiusView
            blast={fnBlast}
            onBack={() => {
              setSelectedFunction(null);
              if (selected) rememberSelection(selected, null);
            }}
            file={selected!}
          />
        ) : (
          blast && <BlastRadiusView blast={blast} file={selected!} />
        )}
      </div>

      {/* Untested hotspots — v0.29 actionable insight panel. Only renders
       *  when the repo has at least one test file we identified, so brand
       *  new repos / projects without tests don't get a confusing
       *  "everything is untested" lecture. */}
      {coverage.totals.testFiles > 0 &&
        coverage.untestedHotspots.length > 0 && (
          <div ref={untestedRef}>
            <UntestedHotspotsPanel
              coverage={coverage}
              onPick={pickFunction}
            />
          </div>
        )}

      {/* Near-duplicate functions — v0.30 actionable insight panel. Only
       *  renders when at least one group of structurally-identical functions
       *  was found above the complexity floor. Brand-new / tiny repos that
       *  have no real duplicates skip this panel entirely. */}
      {duplicateGroups.length > 0 && (
        <div ref={duplicatesRef}>
          <NearDuplicatesPanel
            groups={duplicateGroups}
            onPick={pickFunction}
          />
        </div>
      )}

      {/* Twin lists: heavy files + top complex functions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <HeavyFilesList
          files={heavyFiles}
          coverage={coverage}
          selected={selected}
          onPick={pickFile}
        />
        <TopFunctionsList
          functions={topFunctions}
          onPick={pickFunction}
        />
      </div>
    </div>
  );
}

// ------------------- Coverage chip -------------------

/** Stable display labels for the AST plugins, in alphabetical-ish order
 *  matching the order languages migrated. Anything not in this map is
 *  treated as regex-fallback (or future plugins; the chip will list "other"
 *  if a new plugin shows up without a label). */
const AST_PLUGIN_LABELS: Record<string, string> = {
  javascript: "JS/TS",
  python: "Python",
  go: "Go",
  java: "Java",
  csharp: "C#",
};

function CoverageChip({ cg }: { cg: CodeGraph }) {
  // Sum stats across every plugin that produced output. Pre-v0.21 this was
  // hardcoded to read javascript-only; that was correct when JS/TS was the
  // only AST plugin, but a 100% C# / Java / Go / Python repo showed
  // "0 call-sites" because the chip wasn't summing across plugins.
  const fbStats = cg.byPlugin["regex-fallback"];
  const fbFiles = fbStats?.files ?? 0;

  let astFiles = 0;
  let totalCalls = 0;
  const activeAstLangs: string[] = [];
  for (const [pluginName, stats] of Object.entries(cg.byPlugin)) {
    if (!stats) continue;
    if (pluginName === "regex-fallback") continue;
    astFiles += stats.files ?? 0;
    totalCalls += stats.calls ?? 0;
    if (stats.files > 0) {
      activeAstLangs.push(AST_PLUGIN_LABELS[pluginName] ?? pluginName);
    }
  }

  const fnCount = cg.functions.length;
  // Sentence-case list: "JS/TS, Python, Go" — short enough to fit inline,
  // tells the user exactly which plugins ran on this repo.
  const langSuffix =
    activeAstLangs.length > 0 ? ` (${activeAstLangs.join(", ")})` : "";

  return (
    <div
      className="flex flex-wrap items-center gap-2 text-xs px-3 py-2 rounded-lg"
      style={{
        background: TOK.surface,
        border: `1px solid ${TOK.border}`,
        color: TOK.textSecondary,
      }}
    >
      <Sparkles size={13} style={{ color: TOK.accent }} />
      <span>
        <strong style={{ color: TOK.textPrimary }}>{astFiles}</strong> AST
        files{langSuffix}
      </span>
      <span style={{ color: TOK.textMuted }}>·</span>
      <span>
        <strong style={{ color: TOK.textPrimary }}>{fnCount}</strong> functions
        with complexity
      </span>
      <span style={{ color: TOK.textMuted }}>·</span>
      <span>
        <strong style={{ color: TOK.textPrimary }}>
          {totalCalls.toLocaleString()}
        </strong>{" "}
        call-sites
      </span>
      {fbFiles > 0 && (
        <>
          <span style={{ color: TOK.textMuted }}>·</span>
          <span>
            <strong style={{ color: TOK.textPrimary }}>{fbFiles}</strong> regex-
            fallback files (imports only)
          </span>
        </>
      )}
    </div>
  );
}

// ------------------- Selected-file header + picker -------------------

interface FnChipSummary {
  name: string;
  complexity: number;
  startRow: number;
  containerType?: string;
}

interface FnChipGroup {
  /** All overloads (or single function) sharing the same containerType +
   *  name. Always at least one entry; length > 1 means an overload. */
  entries: FnChipSummary[];
  /** Highest complexity across the group — drives the chip's number
   *  badge and the sort order. */
  maxComplexity: number;
}

/** v0.72.1: collapse Java/C# method overloads into a single chip per
 *  (containerType, name) tuple. The blast-radius computation in
 *  lib/codeAnalysis/blastRadius.ts can't distinguish overloads (CallEdge
 *  carries name + container, no signature), so rendering them as
 *  separate clickable chips is misleading — both clicks would zoom to
 *  the same aggregated radius. One chip per group + a `×N` overload
 *  marker matches the data reality and keeps the UI honest. */
function collapseOverloads(fns: FnChipSummary[]): FnChipGroup[] {
  const groups = new Map<string, FnChipGroup>();
  for (const fn of fns) {
    const key = `${fn.containerType ?? ""}@${fn.name}`;
    let g = groups.get(key);
    if (!g) {
      g = { entries: [], maxComplexity: 0 };
      groups.set(key, g);
    }
    g.entries.push(fn);
    if (fn.complexity > g.maxComplexity) g.maxComplexity = fn.complexity;
  }
  // Preserve max-complexity-desc ordering so the .slice(0, 6) downstream
  // keeps surfacing the heaviest hot-spots first.
  return [...groups.values()].sort((a, b) => b.maxComplexity - a.maxComplexity);
}

function SelectedFileHeader({
  selected,
  complexity,
  functions,
  activeFunction,
  onSelectFunction,
  query,
  onQueryChange,
  filtered,
  onPick,
}: {
  selected: string | null;
  complexity: number | null;
  /** Functions to render as chips. v0.28: every function shows as its
   *  own chip — no name-dedup. (containerType, name) tuples are unique
   *  in the call graph so each chip produces a distinct blast radius
   *  when clicked. */
  functions: {
    name: string;
    complexity: number;
    startRow: number;
    containerType?: string;
  }[];
  /** When set, the matching chip lights up to indicate function mode is on.
   *  Match is on (name, containerType) tuple — overloads stay distinct. */
  activeFunction: { name: string; containerType?: string } | null;
  onSelectFunction: (name: string, containerType?: string) => void;
  query: string;
  onQueryChange: (q: string) => void;
  filtered: string[];
  onPick: (f: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const showResults = pickerOpen && (query.length > 0 || filtered.length > 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Target size={15} style={{ color: TOK.accent }} />
          <span
            className="text-xs uppercase tracking-wider inline-flex items-center gap-1.5"
            style={{ color: TOK.textMuted }}
          >
            Blast radius for
            <HelpHint
              anchor="blast-radius"
              label="Callers, callees, hops, and chip overload markers"
            />
          </span>
        </div>
        {complexity !== null && (
          <span
            className="text-xs px-2 py-0.5 rounded font-mono tabular-nums"
            style={{
              background: TOK.surfaceElevated,
              color: TOK.textSecondary,
              border: `1px solid ${TOK.border}`,
            }}
          >
            file complexity {complexity}
          </span>
        )}
      </div>

      {/* Selected path */}
      {selected && (
        <div
          className="text-sm font-mono break-all"
          style={{ color: TOK.textPrimary }}
          title={selected}
        >
          {selected}
        </div>
      )}

      {/* Top functions in the selected file. Clickable: zooms blast radius
       *  in to function-level for the picked one.
       *
       *  v0.72.1: overloads (Java's `login(String)` vs
       *  `login(String, String)` — same containerType + name, different
       *  signatures) are COLLAPSED into a single chip. The underlying
       *  CallEdge data doesn't carry signatures, so blast radius for
       *  one overload is identical to blast radius for the other —
       *  rendering them as separate clickable chips would be
       *  misleading (clicks would all zoom to the same aggregated
       *  radius, but users couldn't tell which "version" they were
       *  seeing). Showing one chip with a `×N` marker matches the
       *  data reality and the tooltip lists each overload's line for
       *  transparency. */}
      {functions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {collapseOverloads(functions)
            .slice(0, 6)
            .map((group) => {
              const head = group.entries[0];
              const overloadCount = group.entries.length;
              const active =
                activeFunction !== null &&
                activeFunction.name === head.name &&
                activeFunction.containerType === head.containerType;
              // Java + C# name constructors after the class itself, so a
              // constructor for `Foo` shows up as containerType="Foo",
              // name="Foo" — which renders as "Foo.Foo", easily mistaken
              // for "the class itself" by readers. Detect this and render
              // the natural `new Foo` form instead.
              const isConstructor =
                !!head.containerType && head.containerType === head.name;
              const titleLines = [
                ...group.entries.map(
                  (fn) => `Line ${fn.startRow + 1} · complexity ${fn.complexity}`
                ),
                active ? "" : "Click to focus",
              ].filter(Boolean);
              return (
                <button
                  key={`${head.containerType ?? ""}@${head.name}`}
                  onClick={() => onSelectFunction(head.name, head.containerType)}
                  className="text-[11px] px-1.5 py-0.5 rounded font-mono transition cursor-pointer"
                  style={{
                    background: active ? TOK.accentSoft : TOK.surfaceElevated,
                    color: active ? TOK.textPrimary : TOK.textSecondary,
                    border: `1px solid ${active ? TOK.accent : TOK.border}`,
                  }}
                  title={titleLines.join("\n")}
                  onMouseEnter={(e) => {
                    if (!active)
                      e.currentTarget.style.borderColor = TOK.borderStrong;
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.borderColor = TOK.border;
                  }}
                >
                  {isConstructor ? (
                    <>
                      <span style={{ color: TOK.textMuted }}>new </span>
                      {head.name}
                    </>
                  ) : (
                    <>
                      {head.containerType && (
                        <span style={{ color: TOK.textMuted }}>
                          {head.containerType}.
                        </span>
                      )}
                      {head.name}
                    </>
                  )}{" "}
                  <span style={{ color: active ? TOK.accent : TOK.textMuted }}>
                    {group.maxComplexity}
                  </span>
                  {overloadCount > 1 && (
                    <span
                      style={{ color: TOK.textMuted, marginLeft: 4 }}
                      title={`${overloadCount} overloads`}
                    >
                      ×{overloadCount}
                    </span>
                  )}
                </button>
              );
            })}
        </div>
      )}

      {/* File picker */}
      <div className="relative">
        <SearchInput
          value={query}
          onChange={onQueryChange}
          onFocus={() => setPickerOpen(true)}
          onBlur={() => setTimeout(() => setPickerOpen(false), 150)}
          placeholder="Pick another file… (search by path)"
        />
        {showResults && filtered.length > 0 && (
          <div
            className="absolute z-10 left-0 right-0 mt-1 rounded-lg overflow-hidden"
            style={{
              background: TOK.surfaceElevated,
              border: `1px solid ${TOK.borderStrong}`,
              maxHeight: 360,
              overflowY: "auto",
            }}
          >
            {filtered.map((f) => (
              <button
                key={f}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(f)}
                className="block w-full text-left px-3 py-1.5 text-xs font-mono transition"
                style={{ color: TOK.textSecondary }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = TOK.surface;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                {f}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------- Blast radius views -------------------
//
// Two views, one shared section primitive. File mode shows just the path;
// function mode shows the function name with the path as a muted secondary
// line so users can tell which file the function lives in without crowding
// the header.

/** Unified shape for both file-level and function-level entries. The list
 *  primitive renders `primary` prominently and `secondary` (when set) muted
 *  underneath. */
interface BlastListEntry {
  primary: string;
  secondary?: string;
  hop: number;
}

function BlastRadiusView({
  blast,
  file,
}: {
  blast: BlastRadius;
  file: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end -mb-1">
        <CopyLinkButton
          variant="labeled"
          params={{
            tab: "code",
            file,
            focus: "blast",
            fn: undefined,
            container: undefined,
            group: undefined,
          }}
          title="Copy link to this file's blast radius"
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <BlastSection
          title="Incoming — what breaks if this changes"
          icon={<ArrowDownToLine size={14} />}
          accent={TOK.amber}
          unit="files"
          entries={blast.incoming.map((e) => ({ primary: e.filePath, hop: e.hop }))}
          byHop={blast.byHop.incoming}
        />
        <BlastSection
          title="Outgoing — what this depends on"
          icon={<ArrowUpFromLine size={14} />}
          accent={TOK.accent}
          unit="files"
          entries={blast.outgoing.map((e) => ({ primary: e.filePath, hop: e.hop }))}
          byHop={blast.byHop.outgoing}
        />
        {blast.truncated && (
          <div
            className="md:col-span-2 text-[11px] flex items-center gap-2 px-2"
            style={{ color: TOK.textMuted }}
          >
            {blast.truncated} — list above is partial.
          </div>
        )}
      </div>
    </div>
  );
}

function FunctionBlastRadiusView({
  blast,
  onBack,
  file,
}: {
  blast: FunctionBlastRadius;
  onBack: () => void;
  file: string;
}) {
  const totalCalls = blast.incoming.length + blast.outgoing.length;
  const isEmpty = totalCalls === 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={onBack}
            className="text-[11px] flex items-center gap-1 px-2 py-1 rounded transition cursor-pointer"
            style={{
              background: TOK.surfaceElevated,
              color: TOK.textSecondary,
              border: `1px solid ${TOK.border}`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = TOK.borderStrong;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = TOK.border;
            }}
          >
            <ArrowLeft size={11} />
            Back to file blast radius
          </button>
          <span
            className="text-[11px] flex items-center gap-1"
            style={{ color: TOK.textMuted }}
          >
            <Target size={11} style={{ color: TOK.accent }} />
            Zoomed into <span
              className="font-mono"
              style={{ color: TOK.textPrimary }}
            >
              {blast.target.containerType && (
                <span style={{ color: TOK.textMuted }}>
                  {blast.target.containerType}.
                </span>
              )}
              {blast.target.name}
            </span>
          </span>
        </div>
        <CopyLinkButton
          variant="labeled"
          params={{
            tab: "code",
            file,
            fn: blast.target.name,
            container: blast.target.containerType,
            focus: "blast",
            group: undefined,
          }}
          title="Copy link to this function's blast radius"
        />
      </div>

      {/* Call-edge availability hint when both directions are empty.
       *  Common reasons: file is parsed by regex-fallback (no resolved calls),
       *  function is leaf-level on both sides, or the call sites use
       *  expressions our resolver can't yet handle. */}
      {isEmpty && (
        <div
          className="text-[11px] px-3 py-2 rounded"
          style={{
            background: TOK.bg,
            border: `1px dashed ${TOK.border}`,
            color: TOK.textMuted,
          }}
        >
          No resolved call edges for this function. Either nothing calls it
          (and it calls nothing internal), or the file is parsed by the
          regex-fallback plugin which doesn&apos;t emit call edges.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <BlastSection
          title="Callers — functions that call this"
          icon={<PhoneIncoming size={14} />}
          accent={TOK.amber}
          unit="functions"
          entries={blast.incoming.map((e) => ({
            primary: e.containerType ? `${e.containerType}.${e.name}` : e.name,
            secondary: e.filePath,
            hop: e.hop,
          }))}
          byHop={blast.byHop.incoming}
        />
        <BlastSection
          title="Callees — functions this calls"
          icon={<PhoneOutgoing size={14} />}
          accent={TOK.accent}
          unit="functions"
          entries={blast.outgoing.map((e) => ({
            primary: e.containerType ? `${e.containerType}.${e.name}` : e.name,
            secondary: e.filePath,
            hop: e.hop,
          }))}
          byHop={blast.byHop.outgoing}
        />
        {blast.truncated && (
          <div
            className="md:col-span-2 text-[11px] flex items-center gap-2 px-2"
            style={{ color: TOK.textMuted }}
          >
            {blast.truncated} — list above is partial.
          </div>
        )}
      </div>
    </div>
  );
}

function BlastSection({
  title,
  icon,
  accent,
  unit,
  entries,
  byHop,
}: {
  title: string;
  icon: React.ReactNode;
  accent: string;
  unit: "files" | "functions";
  entries: BlastListEntry[];
  byHop: Record<number, number>;
}) {
  const [expanded, setExpanded] = useState(false);
  const limit = expanded ? EXPANDED_LIST_SIZE : INITIAL_LIST_SIZE;
  const shown = entries.slice(0, limit);
  const hidden = Math.max(0, entries.length - limit);

  return (
    <div
      className="rounded-lg p-3 flex flex-col gap-2"
      style={{
        background: TOK.bg,
        border: `1px solid ${TOK.border}`,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs" style={{ color: accent }}>
          {icon}
          <span style={{ color: TOK.textPrimary }}>{title}</span>
        </div>
        <span
          className="text-[11px] font-mono tabular-nums"
          style={{ color: TOK.textMuted }}
        >
          {entries.length} {unit}
        </span>
      </div>

      {/* Hop counters */}
      <div className="flex flex-wrap gap-1.5 text-[11px]">
        {Object.keys(byHop).length === 0 ? (
          <span style={{ color: TOK.textMuted }}>none</span>
        ) : (
          Object.entries(byHop)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([hop, count]) => (
              <span
                key={hop}
                className="px-1.5 py-0.5 rounded font-mono tabular-nums"
                style={{
                  background: TOK.surfaceElevated,
                  color: TOK.textSecondary,
                  border: `1px solid ${TOK.border}`,
                }}
              >
                hop {hop}: {count}
              </span>
            ))
        )}
      </div>

      {/* Entry list. Two-line layout when secondary is provided (function
       *  mode shows the file path as muted context under the function name). */}
      {shown.length > 0 && (
        <ul className="flex flex-col gap-0.5 mt-1">
          {shown.map((e, idx) => (
            <li
              key={`${e.primary}@${e.secondary ?? ""}@${idx}`}
              className="text-[11px] font-mono flex items-center gap-2 py-0.5"
              style={{ color: TOK.textSecondary }}
            >
              <span
                className="inline-flex items-center justify-center text-[9px] tabular-nums w-5 h-4 rounded shrink-0"
                style={{
                  background: TOK.surfaceElevated,
                  color: TOK.textMuted,
                  border: `1px solid ${TOK.border}`,
                }}
                title={`hop ${e.hop}`}
              >
                {e.hop}
              </span>
              <div className="flex-1 min-w-0 flex flex-col">
                <span className="truncate" title={e.primary}>
                  {e.primary}
                </span>
                {e.secondary && (
                  <span
                    className="truncate text-[10px]"
                    style={{ color: TOK.textMuted }}
                    title={e.secondary}
                  >
                    {e.secondary}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {hidden > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="text-[11px] flex items-center gap-1 transition self-start"
          style={{ color: TOK.textSecondary }}
        >
          <ChevronDown size={12} />
          Show {hidden} more
        </button>
      )}
      {expanded && entries.length > INITIAL_LIST_SIZE && (
        <button
          onClick={() => setExpanded(false)}
          className="text-[11px] flex items-center gap-1 transition self-start"
          style={{ color: TOK.textMuted }}
        >
          <ChevronRight size={12} />
          Collapse
        </button>
      )}
    </div>
  );
}

// ------------------- Heavy files list -------------------

function HeavyFilesList({
  files,
  coverage,
  selected,
  onPick,
}: {
  files: { file: string; complexity: number }[];
  /** v0.29: per-file coverage stats. Pass undefined to suppress the
   *  badge column (e.g. on legacy snapshots without codeGraph). */
  coverage: TestCoverage;
  selected: string | null;
  onPick: (f: string) => void;
}) {
  const top = files.slice(0, 15);

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{
        background: TOK.surface,
        border: `1px solid ${TOK.border}`,
      }}
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider" style={{ color: TOK.textMuted }}>
        <FileCode size={13} />
        <span>Heaviest files</span>
        <span style={{ color: TOK.textMuted, textTransform: "none" }}>
          (by file complexity, not function count)
        </span>
      </div>

      <ul className="flex flex-col gap-0.5">
        {top.map(({ file, complexity }) => {
          const isSelected = file === selected;
          const fileCov = coverage.byFile.get(file);
          return (
            <li key={file}>
              <button
                onClick={() => onPick(file)}
                className="w-full flex items-center gap-3 py-1.5 px-2 rounded transition text-left"
                style={{
                  background: isSelected ? TOK.accentSoft : "transparent",
                  color: isSelected ? TOK.textPrimary : TOK.textSecondary,
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.background = TOK.surfaceElevated;
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.background = "transparent";
                }}
              >
                <span
                  className="text-[10px] font-mono tabular-nums w-10 text-right"
                  style={{ color: isSelected ? TOK.accent : TOK.textMuted }}
                >
                  {complexity}
                </span>
                <span className="text-[11px] font-mono truncate flex-1" title={file}>
                  {file}
                </span>
                {fileCov && fileCov.total > 0 && (
                  <CoverageBadge
                    tested={fileCov.tested}
                    total={fileCov.total}
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Compact coverage chip — "5/8" with a color indicating the ratio.
 *  - 0% covered  → rose (untested, needs attention)
 *  - 1-50% covered → amber (partial coverage)
 *  - 51-100% covered → accent / green (good coverage)
 *  Tooltip explains the numbers since the chip itself is dense. */
function CoverageBadge({ tested, total }: { tested: number; total: number }) {
  const ratio = tested / total;
  const color =
    ratio === 0 ? TOK.rose : ratio < 0.5 ? TOK.amber : TOK.accent;
  return (
    <span
      className="text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded shrink-0"
      style={{
        background: TOK.surfaceElevated,
        border: `1px solid ${color}33`,
        color,
      }}
      title={`${tested} of ${total} function${total === 1 ? "" : "s"} have a direct test caller`}
    >
      {tested}/{total}
    </span>
  );
}

// ------------------- Untested hotspots panel (v0.29) -------------------

function UntestedHotspotsPanel({
  coverage,
  onPick,
}: {
  coverage: TestCoverage;
  onPick: (file: string, fnName: string, containerType?: string) => void;
}) {
  const items = coverage.untestedHotspots.slice(0, 8);
  const { prodFunctions, testedProdFunctions, testFiles } = coverage.totals;
  const coveragePct =
    prodFunctions > 0
      ? Math.round((testedProdFunctions / prodFunctions) * 100)
      : 0;
  const [isExpanded, toggle] = usePanelExpansion(
    "gitvision:codepanel:untested-expanded"
  );

  return (
    <div
      className="rounded-xl p-5 flex flex-col gap-4"
      style={{
        background: TOK.surface,
        border: `1px solid ${TOK.border}`,
      }}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          onClick={toggle}
          className="flex items-center gap-2 text-left -m-1 p-1 rounded transition cursor-pointer min-w-0 flex-1"
          title={isExpanded ? "Collapse panel" : "Expand panel"}
        >
          {isExpanded ? (
            <ChevronDown size={14} style={{ color: TOK.textMuted }} />
          ) : (
            <ChevronRight size={14} style={{ color: TOK.textMuted }} />
          )}
          <ShieldOff size={15} style={{ color: TOK.amber }} />
          <span
            className={`${STYLE.eyebrow} inline-flex items-center gap-1.5`}
            style={{ color: TOK.textPrimary }}
          >
            Untested hotspots
            <HelpHint
              anchor="untested-duplicates"
              label="How untested coverage is detected and ranked"
            />
          </span>
          <span style={{ color: TOK.textMuted }}>·</span>
          <span className="text-xs truncate" style={{ color: TOK.textSecondary }}>
            most complex functions with no direct test callers
          </span>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="text-[11px] font-mono inline-flex items-center gap-1.5"
            style={{ color: TOK.textMuted }}
            title={`${testedProdFunctions} of ${prodFunctions} prod functions have a direct caller from one of ${testFiles} test files`}
          >
            <FlaskConical size={11} />
            {coveragePct}% prod fns covered
          </span>
          <CopyLinkButton
            params={{
              tab: "code",
              focus: "untested",
              file: undefined,
              fn: undefined,
              container: undefined,
              group: undefined,
            }}
            title="Copy link to the Untested Hotspots panel"
          />
        </div>
      </div>

      {isExpanded && (
      <ul className="flex flex-col gap-0.5">
        {items.map((h) => (
          // startRow disambiguates overloaded methods (Java's
          // `login(String)` vs `login(String, String)` share name +
          // container + path but differ on line number).
          <li
            key={`${h.filePath}:${h.containerType ?? ""}:${h.name}:${h.startRow}`}
          >
            <button
              onClick={() => onPick(h.filePath, h.name, h.containerType)}
              className="w-full flex items-center gap-3 py-1.5 px-2 rounded text-left transition"
              style={{ color: TOK.textSecondary }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = TOK.surfaceElevated;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <span
                className="text-[10px] font-mono tabular-nums w-10 text-right"
                style={{ color: complexityColor(h.complexity) }}
              >
                {h.complexity}
              </span>
              <div className="flex-1 min-w-0 flex flex-col">
                <span
                  className="text-xs font-mono truncate"
                  style={{ color: TOK.textPrimary }}
                  title={
                    h.containerType ? `${h.containerType}.${h.name}` : h.name
                  }
                >
                  {h.containerType && (
                    <span style={{ color: TOK.textMuted }}>
                      {h.containerType}.
                    </span>
                  )}
                  {h.name}
                </span>
                <span
                  className="text-[10px] font-mono truncate"
                  style={{ color: TOK.textMuted }}
                  title={h.filePath}
                >
                  {h.filePath}
                </span>
              </div>
              <span
                className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                style={{
                  background: TOK.surfaceElevated,
                  color: TOK.amber,
                  border: `1px solid ${TOK.amber}33`,
                }}
                title="No test file directly calls this function"
              >
                untested
              </span>
            </button>
          </li>
        ))}
      </ul>
      )}
    </div>
  );
}

// ------------------- Near-duplicates panel (v0.30) -------------------

/** Grouped list of structurally-identical functions. Each group expands to
 *  reveal every member; clicking a member zooms the blast radius into that
 *  exact (file, name, containerType) tuple so users can immediately see who
 *  depends on each copy.
 *
 *  We default the most-painful group expanded (top of the list, highest
 *  groupSize × maxComplexity) so the panel tells a story at a glance:
 *  "this 23-line block of logic exists in 5 different files — here they are."
 *  Subsequent groups are collapsed to keep the panel scannable. */
function NearDuplicatesPanel({
  groups,
  onPick,
}: {
  groups: DuplicateGroup[];
  onPick: (file: string, fnName: string, containerType?: string) => void;
}) {
  const stats = summarizeDuplicates(groups);
  const searchParams = useSearchParams();
  // Track which groups are expanded. Default: only the first (worst) group
  // is open so the panel previews the worst offender without flooding the
  // viewport when there are 15 groups.
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set(groups[0] ? [groups[0].hash] : [])
  );
  const [isPanelExpanded, togglePanel] = usePanelExpansion(
    "gitvision:codepanel:duplicates-expanded"
  );

  // v0.37: deep-link `?group=<hash>` auto-expands a specific group on
  // mount. Applied once via deepLinkApplied so subsequent in-component
  // toggling isn't fought by the URL.
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (deepLinkApplied.current) return;
    const groupHash = searchParams.get("group");
    if (groupHash && groups.some((g) => g.hash === groupHash)) {
      setOpenGroups((prev) => new Set([...prev, groupHash]));
    }
    deepLinkApplied.current = true;
  }, [searchParams, groups]);

  function toggleGroup(hash: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });
  }

  return (
    <div
      className="rounded-xl p-5 flex flex-col gap-4"
      style={{
        background: TOK.surface,
        border: `1px solid ${TOK.border}`,
      }}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          onClick={togglePanel}
          className="flex items-center gap-2 text-left -m-1 p-1 rounded transition cursor-pointer min-w-0 flex-1"
          title={isPanelExpanded ? "Collapse panel" : "Expand panel"}
        >
          {isPanelExpanded ? (
            <ChevronDown size={14} style={{ color: TOK.textMuted }} />
          ) : (
            <ChevronRight size={14} style={{ color: TOK.textMuted }} />
          )}
          <Copy size={15} style={{ color: TOK.accent }} />
          <span
            className={`${STYLE.eyebrow} inline-flex items-center gap-1.5`}
            style={{ color: TOK.textPrimary }}
          >
            Near-duplicate functions
            <HelpHint
              anchor="untested-duplicates"
              label="How AST-based duplicate groups are detected"
            />
          </span>
          <span style={{ color: TOK.textMuted }}>·</span>
          <span className="text-xs truncate" style={{ color: TOK.textSecondary }}>
            structurally identical bodies — candidates for extraction
          </span>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="text-[11px] font-mono inline-flex items-center gap-1.5"
            style={{ color: TOK.textMuted }}
            title={`${stats.totalDuplicateFunctions} duplicate functions across ${stats.totalGroups} groups; the largest group has ${stats.largestGroupSize} copies`}
          >
            {stats.totalGroups} groups · {stats.totalDuplicateFunctions} fns ·
            largest ×{stats.largestGroupSize}
          </span>
          <CopyLinkButton
            params={{
              tab: "code",
              focus: "duplicates",
              file: undefined,
              fn: undefined,
              container: undefined,
              group: undefined,
            }}
            title="Copy link to the Near-Duplicates panel"
          />
        </div>
      </div>

      {isPanelExpanded && (
      <ul className="flex flex-col gap-1.5">
        {groups.map((g) => {
          const isOpen = openGroups.has(g.hash);
          const first = g.members[0];
          return (
            <li
              key={g.hash}
              className="rounded-lg"
              style={{
                background: TOK.bg,
                border: `1px solid ${TOK.border}`,
              }}
            >
              <button
                onClick={() => toggleGroup(g.hash)}
                className="w-full flex items-center gap-3 py-2 px-2.5 rounded-lg text-left transition cursor-pointer"
                style={{ color: TOK.textSecondary }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = TOK.surfaceElevated;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
                title={
                  isOpen
                    ? "Click to collapse this group"
                    : "Click to expand and see every copy"
                }
              >
                <span
                  className="text-[10px] font-mono tabular-nums w-10 text-right"
                  style={{ color: complexityColor(g.maxComplexity) }}
                  title={`Highest complexity in group: ${g.maxComplexity}`}
                >
                  {g.maxComplexity}
                </span>
                <span
                  className="text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded shrink-0"
                  style={{
                    background: TOK.surfaceElevated,
                    color: TOK.accent,
                    border: `1px solid ${TOK.accent}33`,
                  }}
                  title={`${g.members.length} structurally identical copies`}
                >
                  ×{g.members.length}
                </span>
                <div className="flex-1 min-w-0 flex flex-col">
                  <span
                    className="text-xs font-mono truncate"
                    style={{ color: TOK.textPrimary }}
                    title={
                      first.containerType
                        ? `${first.containerType}.${first.name}`
                        : first.name
                    }
                  >
                    {first.containerType && (
                      <span style={{ color: TOK.textMuted }}>
                        {first.containerType}.
                      </span>
                    )}
                    {first.name}
                    {g.members.length > 1 && (
                      <span style={{ color: TOK.textMuted }}>
                        {" "}
                        + {g.members.length - 1} more
                      </span>
                    )}
                  </span>
                  <span
                    className="text-[10px] font-mono truncate"
                    style={{ color: TOK.textMuted }}
                    title={first.filePath}
                  >
                    {first.filePath}
                  </span>
                </div>
                {isOpen ? (
                  <ChevronDown
                    size={14}
                    style={{ color: TOK.textMuted }}
                  />
                ) : (
                  <ChevronRight
                    size={14}
                    style={{ color: TOK.textMuted }}
                  />
                )}
              </button>

              {isOpen && (
                <div
                  className="px-2 pb-2"
                  style={{ borderTop: `1px solid ${TOK.border}` }}
                >
                  <div className="flex justify-end pt-1">
                    <CopyLinkButton
                      params={{
                        tab: "code",
                        focus: "duplicates",
                        group: g.hash,
                        file: undefined,
                        fn: undefined,
                        container: undefined,
                      }}
                      title="Copy link to this duplicate group"
                    />
                  </div>
                  <ul className="flex flex-col gap-0.5">
                  {g.members.map((m, idx) => (
                    <li key={`${m.filePath}:${m.containerType ?? ""}:${m.name}@${m.startRow}`}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onPick(m.filePath, m.name, m.containerType);
                        }}
                        className="w-full flex items-center gap-3 py-1 px-2 rounded text-left transition mt-1"
                        style={{ color: TOK.textSecondary }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = TOK.surfaceElevated;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                        }}
                        title="Click to zoom blast radius into this copy"
                      >
                        <span
                          className="text-[9px] font-mono tabular-nums w-5 text-right"
                          style={{ color: TOK.textMuted }}
                        >
                          {idx + 1}
                        </span>
                        <span
                          className="text-[10px] font-mono tabular-nums w-8 text-right"
                          style={{ color: complexityColor(m.complexity) }}
                          title={`complexity ${m.complexity}`}
                        >
                          {m.complexity}
                        </span>
                        <div className="flex-1 min-w-0 flex flex-col">
                          <span
                            className="text-[11px] font-mono truncate"
                            style={{ color: TOK.textPrimary }}
                            title={
                              m.containerType
                                ? `${m.containerType}.${m.name}`
                                : m.name
                            }
                          >
                            {m.containerType && (
                              <span style={{ color: TOK.textMuted }}>
                                {m.containerType}.
                              </span>
                            )}
                            {m.name}
                          </span>
                          <span
                            className="text-[10px] font-mono truncate"
                            style={{ color: TOK.textMuted }}
                            title={m.filePath}
                          >
                            {m.filePath}:{m.startRow + 1}
                          </span>
                        </div>
                      </button>
                    </li>
                  ))}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      )}
    </div>
  );
}

// ------------------- Top functions list -------------------

function TopFunctionsList({
  functions,
  onPick,
}: {
  functions: {
    filePath: string;
    name: string;
    complexity: number;
    startRow: number;
    /** Class/struct/etc. this function belongs to, when type-aware extraction
     *  caught it. v0.15+ for Java, v0.16+ for Go, v0.17+ for TS, v0.18+ for
     *  Python. Top-level functions stay undefined. */
    containerType?: string;
  }[];
  /** Receives the file, name, and containerType so the panel can zoom
   *  straight into function-level blast radius for the exact (file,
   *  name, container) tuple — distinguishing same-named overloads. */
  onPick: (file: string, fnName: string, containerType?: string) => void;
}) {
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{
        background: TOK.surface,
        border: `1px solid ${TOK.border}`,
      }}
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider" style={{ color: TOK.textMuted }}>
        <CodeIcon size={13} />
        <span>Most complex functions</span>
        <span style={{ color: TOK.textMuted, textTransform: "none" }}>
          (click to zoom into function blast radius)
        </span>
      </div>

      <ul className="flex flex-col gap-0.5">
        {functions.slice(0, 15).map((fn) => (
          <li key={`${fn.filePath}:${fn.containerType ?? ""}:${fn.name}@${fn.startRow}`}>
            <button
              onClick={() => onPick(fn.filePath, fn.name, fn.containerType)}
              className="w-full flex items-center gap-3 py-1.5 px-2 rounded text-left transition"
              style={{ color: TOK.textSecondary }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = TOK.surfaceElevated;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <span
                className="text-[10px] font-mono tabular-nums w-10 text-right"
                style={{ color: complexityColor(fn.complexity) }}
              >
                {fn.complexity}
              </span>
              <div className="flex-1 min-w-0 flex flex-col">
                <span
                  className="text-xs font-mono truncate"
                  style={{ color: TOK.textPrimary }}
                  title={
                    fn.containerType
                      ? `${fn.containerType}.${fn.name}`
                      : fn.name
                  }
                >
                  {fn.containerType && (
                    <span style={{ color: TOK.textMuted }}>
                      {fn.containerType}.
                    </span>
                  )}
                  {fn.name}
                </span>
                <span
                  className="text-[10px] font-mono truncate"
                  style={{ color: TOK.textMuted }}
                  title={fn.filePath}
                >
                  {fn.filePath}:{fn.startRow + 1}
                </span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Color scale for complexity numbers — calmer than rose for everything,
 *  amber once it crosses "this should be split", rose past "actively scary". */
function complexityColor(c: number): string {
  if (c >= 50) return TOK.rose;
  if (c >= 20) return TOK.amber;
  if (c >= 10) return TOK.accent;
  return TOK.textMuted;
}

// ------------------- Empty state -------------------

function EmptyState({ reason }: { reason?: string }) {
  // Two distinct empty-state cases, surfaced explicitly:
  //   - Pre-v0.10 snapshot (no codeGraph, no skip reason) → "click Refresh"
  //   - v0.19+ snapshot where analysis was skipped (skip reason present) →
  //     show the actual reason so the user understands what happened
  const isSkipped = !!reason;
  return (
    <div
      className="rounded-xl border border-dashed p-10 text-center text-sm flex flex-col items-center gap-3"
      style={{
        borderColor: TOK.border,
        color: TOK.textMuted,
      }}
    >
      <CodeIcon size={20} style={{ color: TOK.textSecondary }} />
      {isSkipped ? (
        <>
          <p style={{ color: TOK.textSecondary }}>
            Code analysis was skipped for this snapshot.
          </p>
          <p
            className="max-w-2xl"
            style={{ color: TOK.textMuted }}
          >
            {reason}
          </p>
          <p
            className="text-xs"
            style={{ color: TOK.textMuted }}
          >
            The other tabs (Canvas / Imports / Packages / PRs / Overview) still
            reflect the latest snapshot — only the call-graph / complexity
            data is missing here.
          </p>
        </>
      ) : (
        <>
          <p style={{ color: TOK.textSecondary }}>
            This snapshot was created before the code-analysis pipeline shipped.
          </p>
          <p>
            Click <strong style={{ color: TOK.textPrimary }}>Refresh</strong>{" "}
            above to populate it. New snapshots include AST-based functions,
            call-graph and complexity for JS/TS, plus imports for the other 7
            languages.
          </p>
        </>
      )}
    </div>
  );
}
