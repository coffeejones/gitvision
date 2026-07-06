"use client";

// Interactive impact analysis — "what breaks if I change this?"
//
// The blast-radius engine (computeBlastRadius / computeFunctionBlastRadius) is
// pure over the CodeGraph and built to recompute in the client on every
// selection, so this is a fully client-side tool: pick a file → instantly see
// its incoming set (what depends on it, i.e. what breaks) and outgoing set
// (what it depends on), grouped by hop distance, with the two risk signals the
// analysis already knows — cross-module callers and, crucially, dependents
// that HAVE NO TEST. From the file view you can drill into a single function
// for the sharper question: "what calls parse(), specifically?"
//
// Free for everyone. The "most depended-on files" shortlist seeds the tool as
// the scariest things to touch.

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Search,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import {
  computeBlastRadius,
  computeFunctionBlastRadius,
} from "@/lib/codeAnalysis/blastRadius";
import {
  deriveTestedFiles,
  impactFileList,
  isTestPath,
  rankFilesByFanIn,
  rankFunctionsInFile,
  toFileHighlight,
  type FunctionImpactRank,
  type ImpactHighlight,
} from "@/lib/impact";
import type { CodeGraph } from "@/lib/codeAnalysis/types";
import { TOK } from "@/lib/sessionTheme";
import { CH_FOCUS } from "@/components/chambers/theme";

const MONO = { fontFamily: "var(--font-mono)" } as const;

function baseName(p: string): string {
  return p.split("/").pop() ?? p;
}

function hopLabel(hop: number): string {
  return hop === 1 ? "direct" : `${hop} hops`;
}

function fnLabel(name: string, containerType?: string): string {
  return containerType ? `${containerType}.${name}` : name;
}

/** Unified row shape for both granularities: file entries have no label;
 *  function entries carry `label` (Container.name) with the path demoted to
 *  the secondary slot. */
interface RowEntry {
  filePath: string;
  hop: number;
  crossModule: boolean;
  label?: string;
}

function EntryRow({
  entry,
  untested,
}: {
  entry: RowEntry;
  untested?: boolean;
}) {
  return (
    <div
      className="flex items-center gap-2 py-1.5 px-2 rounded text-[13px]"
      style={{ borderBottom: `1px solid ${TOK.border}` }}
    >
      {entry.label ? (
        <span className="truncate flex-1 min-w-0" title={`${entry.label} — ${entry.filePath}`}>
          <span style={{ ...MONO, color: TOK.textPrimary }}>{entry.label}</span>
          <span
            className="ml-2 text-[11px]"
            style={{ ...MONO, color: TOK.textMuted }}
          >
            {entry.filePath}
          </span>
        </span>
      ) : (
        <span
          className="truncate flex-1 min-w-0"
          style={{ ...MONO, color: TOK.textSecondary }}
          title={entry.filePath}
        >
          {entry.filePath}
        </span>
      )}
      {untested && (
        <span
          className="shrink-0 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.08em] px-1.5 py-0.5 rounded"
          style={{ background: TOK.roseSoft, color: TOK.rose }}
          title="No test file directly imports or calls into this file — no direct test guards a regression here"
        >
          <TriangleAlert size={10} /> untested
        </span>
      )}
      {entry.crossModule && (
        <span
          className="shrink-0 text-[10px] uppercase tracking-[0.08em] px-1.5 py-0.5 rounded"
          style={{ background: TOK.amberSoft, color: TOK.amber }}
          title="Lives in a different directory than the target — a ripple beyond the module being edited is more surprising"
        >
          cross-module
        </span>
      )}
      <span
        className="shrink-0 text-[10px] tabular-nums"
        style={{ color: TOK.textMuted }}
      >
        {hopLabel(entry.hop)}
      </span>
    </div>
  );
}

// Risk tiers for the "what breaks" column, most-severe first:
//   0 = untested (a regression here is unguarded — the scariest)
//   1 = tested but cross-module (a surprising ripple, still caught by a test)
//   2 = tested, same module (the expected, lowest-concern case)
const TIER_LABEL = [
  "Untested — no test guards a regression",
  "Cross-module ripple",
  "Same module",
] as const;

const COLLAPSED_ROWS = 25;

function isUntested(e: RowEntry, tested: Set<string>): boolean {
  return !isTestPath(e.filePath) && !tested.has(e.filePath);
}

function Column({
  title,
  icon,
  entries,
  emptyLabel,
  tested,
  showUntested,
  riskTiered = false,
  headerless = false,
}: {
  title: string;
  icon: React.ReactNode;
  entries: RowEntry[];
  emptyLabel: string;
  tested: Set<string>;
  showUntested: boolean;
  /** Sort by risk (untested → cross-module → rest) with tier headers, turning
   *  the flat list into a ranked risk story. Used for the primary column. */
  riskTiered?: boolean;
  /** Skip the built-in header — the caller renders its own (a disclosure). */
  headerless?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const tierOf = (e: RowEntry): 0 | 1 | 2 =>
    showUntested && isUntested(e, tested) ? 0 : e.crossModule ? 1 : 2;

  const sorted = [...entries].sort((a, b) => {
    if (riskTiered) {
      const d = tierOf(a) - tierOf(b);
      if (d !== 0) return d;
    }
    return (
      a.hop - b.hop ||
      a.filePath.localeCompare(b.filePath) ||
      (a.label ?? "").localeCompare(b.label ?? "")
    );
  });

  const tierCounts = [0, 1, 2].map(
    (t) => sorted.filter((e) => tierOf(e) === t).length
  );
  // Only group when it earns its keep: a genuinely large list with >1 tier.
  const grouped =
    riskTiered && sorted.length >= 6 && tierCounts.filter((c) => c > 0).length > 1;

  const visible = expanded ? sorted : sorted.slice(0, COLLAPSED_ROWS);

  return (
    <div className="flex flex-col gap-2 min-w-0">
      {!headerless && (
        <div
          className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em]"
          style={{ color: TOK.textMuted }}
        >
          {icon}
          <span>
            {title} · {entries.length}
          </span>
        </div>
      )}
      {sorted.length === 0 ? (
        <p className="text-[13px] py-2" style={{ color: TOK.textMuted }}>
          {emptyLabel}
        </p>
      ) : (
        // Capped with internal scroll so a 200-row blast doesn't push the
        // dependency canvas ~6 screens down — the two coupled views stay
        // close enough to see the canvas react to a selection.
        <div className="flex flex-col max-h-[42vh] overflow-y-auto pr-1">
          {visible.map((e, i) => {
            const tier = tierOf(e);
            const showHeader =
              grouped && (i === 0 || tierOf(visible[i - 1]) !== tier);
            return (
              <Fragment key={`${e.filePath}:${e.label ?? ""}:${e.hop}:${i}`}>
                {showHeader && (
                  <div
                    className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] pt-2 pb-1 px-2 sticky top-0"
                    style={{
                      color: tier === 0 ? TOK.rose : TOK.textMuted,
                      background: TOK.surface,
                    }}
                  >
                    {tier === 0 && <TriangleAlert size={10} />}
                    <span>
                      {TIER_LABEL[tier]} · {tierCounts[tier]}
                    </span>
                  </div>
                )}
                <EntryRow
                  entry={e}
                  untested={showUntested && isUntested(e, tested)}
                />
              </Fragment>
            );
          })}
          {sorted.length > COLLAPSED_ROWS && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className={`text-[11px] py-1.5 px-2 text-left hover:opacity-80 transition rounded ${CH_FOCUS}`}
              style={{ color: TOK.accent }}
            >
              {expanded
                ? "Show less"
                : `Show all ${sorted.length}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ImpactExplorer({
  graph,
  onImpactChange,
}: {
  graph: CodeGraph;
  /** Notifies the parent of the current blast as a per-file overlay (target +
   *  impacted files with min hop), so the dependency canvas can dim everything
   *  the change doesn't reach. Fires on every selection change; null when
   *  nothing is selected. */
  onImpactChange?: (highlight: ImpactHighlight | null) => void;
}) {
  const tested = useMemo(() => deriveTestedFiles(graph), [graph]);
  const topFiles = useMemo(() => rankFilesByFanIn(graph, 8), [graph]);
  const allFiles = useMemo(() => impactFileList(graph), [graph]);
  // Cold-boot with nothing selected: auto-selecting the heaviest file dumped a
  // ~3800px wall of rows before the user did anything. Start with a compact
  // invitation instead; the "Most depended-on" chips are the entry point.
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedFn, setSelectedFn] = useState<FunctionImpactRank | null>(null);
  const [query, setQuery] = useState("");
  // "What it depends on" is the secondary question — collapsed by default so
  // the view leads with "what breaks?".
  const [depsOpen, setDepsOpen] = useState(false);

  const blast = useMemo(
    () => (selected ? computeBlastRadius(graph, selected) : null),
    [graph, selected]
  );

  // Drill-down candidates: the selected file's functions, most-called first.
  const fnRanks = useMemo(
    () => (selected ? rankFunctionsInFile(graph, selected, 12) : []),
    [graph, selected]
  );

  // Total distinct functions in the file — lets us flag when the 12-chip cap
  // hides some, rather than silently truncating the drill-down list.
  const fnTotal = useMemo(() => {
    if (!selected) return 0;
    const keys = new Set<string>();
    for (const fn of graph.functions) {
      if (fn.filePath === selected) {
        keys.add(`${fn.name}\x1E${fn.containerType ?? ""}`);
      }
    }
    return keys.size;
  }, [graph, selected]);

  const fnBlast = useMemo(
    () =>
      selected && selectedFn
        ? computeFunctionBlastRadius(graph, selected, selectedFn.name, {
            targetContainerType: selectedFn.containerType,
          })
        : null,
    [graph, selected, selectedFn]
  );

  // Per-file overlay for the dependency canvas — function-level blasts
  // collapse to the files containing the impacted functions. Memoized so the
  // parent-notify effect below only fires on real selection changes.
  const highlight = useMemo<ImpactHighlight | null>(() => {
    if (!selected) return null;
    const entries = fnBlast ? fnBlast.incoming : (blast?.incoming ?? []);
    return toFileHighlight(selected, entries);
  }, [selected, blast, fnBlast]);

  useEffect(() => {
    onImpactChange?.(highlight);
  }, [highlight, onImpactChange]);

  // A graph swap (e.g. Refresh loads a newer snapshot) can leave `selected` or
  // `selectedFn` pointing at a file/function that no longer exists. Without
  // this reset the tool would render a false "no tracked dependents" and dim
  // the whole canvas. Re-seed to the most-depended-on file when that happens.
  useEffect(() => {
    if (selected && !allFiles.includes(selected)) {
      setSelected(topFiles[0]?.file ?? allFiles[0] ?? null);
      setSelectedFn(null);
      return;
    }
    if (
      selectedFn &&
      !fnRanks.some(
        (r) =>
          r.name === selectedFn.name &&
          r.containerType === selectedFn.containerType
      )
    ) {
      setSelectedFn(null);
    }
  }, [allFiles, topFiles, fnRanks, selected, selectedFn]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return allFiles.filter((f) => f.toLowerCase().includes(q)).slice(0, 40);
  }, [query, allFiles]);

  function pick(file: string) {
    setSelected(file);
    setSelectedFn(null);
    setQuery("");
  }

  // Active entries for the two columns — function mode maps FunctionBlastEntry
  // into the unified row shape (label = Container.name).
  const mode: "file" | "function" = fnBlast ? "function" : "file";
  const incoming: RowEntry[] = fnBlast
    ? fnBlast.incoming.map((e) => ({
        filePath: e.filePath,
        hop: e.hop,
        crossModule: e.crossModule,
        label: fnLabel(e.name, e.containerType),
      }))
    : (blast?.incoming ?? []);
  const outgoing: RowEntry[] = fnBlast
    ? fnBlast.outgoing.map((e) => ({
        filePath: e.filePath,
        hop: e.hop,
        crossModule: e.crossModule,
        label: fnLabel(e.name, e.containerType),
      }))
    : (blast?.outgoing ?? []);

  const truncated = fnBlast ? fnBlast.truncated : blast?.truncated;
  const untestedCount = incoming.filter(
    (e) => !isTestPath(e.filePath) && !tested.has(e.filePath)
  ).length;
  const crossModuleCount = incoming.filter((e) => e.crossModule).length;
  // Exact count out of context, but a floor when the BFS was capped.
  const countLabel = truncated ? `${incoming.length}+` : `${incoming.length}`;
  const plural = incoming.length !== 1 || !!truncated;
  const impactedFileCount =
    mode === "function"
      ? new Set(incoming.map((e) => e.filePath)).size
      : incoming.length;

  return (
    <section className="flex flex-col gap-4" aria-label="Impact analysis">
      <div className="flex flex-col gap-1">
        <span
          className="text-[10px] uppercase tracking-[0.2em] font-medium"
          style={{ color: TOK.textMuted }}
        >
          Impact analysis
        </span>
        <p className="text-sm" style={{ color: TOK.textSecondary }}>
          Pick a file to see what could break if you change it — the dependency
          canvas below highlights the impacted files. Drill into a function to
          see which functions call it directly.
        </p>
      </div>

      {/* Search + most-impactful shortlist */}
      <div className="flex flex-col gap-2.5">
        <div
          className="flex items-center gap-2 rounded-lg px-3 h-10"
          style={{ background: TOK.surface, border: `1px solid ${TOK.border}` }}
        >
          <Search size={14} style={{ color: TOK.textMuted }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches[0]) pick(matches[0]);
              else if (e.key === "Escape") setQuery("");
            }}
            aria-label="Search files for impact analysis"
            placeholder="Search a file…"
            className={`flex-1 bg-transparent text-[13px] rounded ${CH_FOCUS}`}
            style={{ ...MONO, color: TOK.textPrimary }}
          />
        </div>

        {query.trim() && matches.length === 0 ? (
          <p className="text-[13px] px-1 py-1" style={{ color: TOK.textMuted }}>
            No files match “{query.trim()}”.
          </p>
        ) : matches.length > 0 ? (
          <div
            className="flex flex-col rounded-lg overflow-hidden"
            style={{ border: `1px solid ${TOK.border}` }}
          >
            {matches.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => pick(f)}
                className={`text-left px-3 py-1.5 text-[13px] truncate hover:bg-white/5 transition ${CH_FOCUS}`}
                style={{ ...MONO, color: TOK.textSecondary }}
                title={f}
              >
                {f}
              </button>
            ))}
          </div>
        ) : (
          topFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <span
                className="text-[10px] uppercase tracking-[0.1em] self-center mr-1"
                style={{ color: TOK.textMuted }}
              >
                Most depended-on:
              </span>
              {topFiles.map((t) => (
                <button
                  key={t.file}
                  type="button"
                  onClick={() => pick(t.file)}
                  className={`text-[11px] px-2 py-0.5 rounded transition hover:opacity-80 ${CH_FOCUS}`}
                  style={{
                    ...MONO,
                    background:
                      selected === t.file ? TOK.accentSoft : TOK.surface,
                    border: `1px solid ${selected === t.file ? TOK.accent : TOK.border}`,
                    color: selected === t.file ? TOK.accent : TOK.textMuted,
                  }}
                  title={`${t.file} — ${t.dependents} direct dependents`}
                >
                  {baseName(t.file)}
                </button>
              ))}
            </div>
          )
        )}
      </div>

      {/* Cold-boot guidance — nothing selected yet */}
      {!selected && (
        <div
          className="rounded-xl p-4 flex items-center gap-3"
          style={{ background: TOK.surface, border: `1px dashed ${TOK.border}` }}
        >
          <Crosshair size={15} style={{ color: TOK.textMuted }} />
          <p className="text-[13px]" style={{ color: TOK.textSecondary }}>
            Pick a file — search above, or start with the{" "}
            <span style={{ color: TOK.textPrimary }}>most depended-on</span>{" "}
            files, the scariest to change.
          </p>
        </div>
      )}

      {/* Blast display */}
      {selected && blast && (
        <div
          className="flex flex-col gap-4 rounded-xl p-5"
          style={{
            background: TOK.surface,
            border: `1px solid ${TOK.border}`,
          }}
        >
          <div className="flex items-start gap-3">
            <div
              className="shrink-0 rounded-lg p-2"
              style={{
                background: TOK.accentSoft,
                border: `1px solid ${TOK.accent}44`,
              }}
            >
              <Crosshair size={16} style={{ color: TOK.accent }} />
            </div>
            <div className="flex flex-col gap-1 min-w-0">
              <div className="text-[13px]" style={{ color: TOK.textMuted }}>
                Changing{" "}
                {mode === "function" && selectedFn && (
                  <>
                    <span style={{ ...MONO, color: TOK.accent }}>
                      {fnLabel(selectedFn.name, selectedFn.containerType)}()
                    </span>{" "}
                    in{" "}
                  </>
                )}
                <span style={{ ...MONO, color: TOK.textPrimary }}>
                  {selected}
                </span>
              </div>
              {incoming.length === 0 ? (
                <div className="flex flex-col gap-0.5">
                  <div
                    className="inline-flex items-center gap-1.5 text-[15px] font-semibold"
                    style={{ color: TOK.accent }}
                  >
                    <ShieldCheck size={16} />
                    {mode === "function"
                      ? "No tracked callers"
                      : "No tracked dependents"}
                  </div>
                  <span
                    className="text-[12px]"
                    style={{ color: TOK.textMuted }}
                  >
                    {mode === "function"
                      ? "No resolved call edge points here. Dynamic dispatch, reflection, and callers outside this repo aren't tracked."
                      : "Nothing in the import/call graph reaches this file. Dynamic imports, framework wiring, and external consumers aren't tracked."}
                  </span>
                </div>
              ) : (
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span
                    className="text-[17px] font-semibold"
                    style={{ color: TOK.textPrimary }}
                  >
                    {countLabel}{" "}
                    {mode === "function"
                      ? `function${plural ? "s" : ""} call this`
                      : `file${plural ? "s" : ""} depend on this`}
                  </span>
                  <span className="text-[13px]" style={{ color: TOK.textMuted }}>
                    {mode === "function" && (
                      <>across {impactedFileCount} file
                      {impactedFileCount === 1 ? "" : "s"} · </>
                    )}
                    {crossModuleCount} cross-module
                    {untestedCount > 0 && (
                      <>
                        {" · "}
                        <span style={{ color: TOK.rose }}>
                          {untestedCount} untested
                        </span>
                      </>
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Function drill-down chips */}
          {fnRanks.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className="text-[10px] uppercase tracking-[0.1em] mr-1"
                style={{ color: TOK.textMuted }}
              >
                Drill into:
              </span>
              {fnRanks.map((fr) => {
                const active =
                  selectedFn?.name === fr.name &&
                  selectedFn?.containerType === fr.containerType;
                return (
                  <button
                    key={`${fr.containerType ?? ""}.${fr.name}`}
                    type="button"
                    onClick={() => setSelectedFn(active ? null : fr)}
                    className={`text-[11px] px-2 py-0.5 rounded transition hover:opacity-80 ${CH_FOCUS}`}
                    style={{
                      ...MONO,
                      background: active ? TOK.accentSoft : "transparent",
                      border: `1px solid ${active ? TOK.accent : TOK.border}`,
                      color: active ? TOK.accent : TOK.textSecondary,
                    }}
                    title={`${fnLabel(fr.name, fr.containerType)} — ${fr.callers} direct caller${fr.callers === 1 ? "" : "s"}`}
                  >
                    {fnLabel(fr.name, fr.containerType)}
                    {fr.callers > 0 && (
                      <span style={{ color: TOK.textMuted }}> {fr.callers}</span>
                    )}
                  </button>
                );
              })}
              {fnTotal > fnRanks.length && (
                <span
                  className="text-[11px] px-1 self-center"
                  style={{ color: TOK.textMuted }}
                  title={`Showing the ${fnRanks.length} most-called functions of ${fnTotal} in this file`}
                >
                  + {fnTotal - fnRanks.length} more
                </span>
              )}
              {selectedFn && (
                <button
                  type="button"
                  onClick={() => setSelectedFn(null)}
                  className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded transition hover:opacity-80 ${CH_FOCUS}`}
                  style={{
                    border: `1px solid ${TOK.border}`,
                    color: TOK.textMuted,
                  }}
                >
                  <ChevronLeft size={11} /> Back to file
                </button>
              )}
            </div>
          )}

          <div className="flex flex-col gap-4">
            {/* Primary question: what breaks, ranked by risk */}
            <Column
              title="What breaks if this changes"
              icon={<ArrowDownToLine size={12} />}
              entries={incoming}
              emptyLabel={
                mode === "function"
                  ? "No resolved calls into this function."
                  : "Nothing imports or calls into this file."
              }
              tested={tested}
              showUntested
              riskTiered
            />

            {/* Secondary question: what it depends on — collapsed by default */}
            {outgoing.length > 0 && (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setDepsOpen((v) => !v)}
                  className={`flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] hover:opacity-80 transition self-start rounded ${CH_FOCUS}`}
                  style={{ color: TOK.textMuted }}
                  aria-expanded={depsOpen}
                >
                  {depsOpen ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                  <ArrowUpFromLine size={12} />
                  What it depends on · {outgoing.length}
                </button>
                {depsOpen && (
                  <Column
                    headerless
                    title="What it depends on"
                    icon={<ArrowUpFromLine size={12} />}
                    entries={outgoing}
                    emptyLabel={
                      mode === "function"
                        ? "This function doesn't call into anything tracked."
                        : "This file doesn't import or call into anything tracked."
                    }
                    tested={tested}
                    showUntested={false}
                  />
                )}
              </div>
            )}
          </div>

          {truncated && (
            <p className="text-[11px]" style={{ color: TOK.textMuted }}>
              {truncated}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
