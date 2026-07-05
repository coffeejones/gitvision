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

import { useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Crosshair,
  Search,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  computeBlastRadius,
  computeFunctionBlastRadius,
} from "@/lib/codeAnalysis/blastRadius";
import {
  deriveTestedFiles,
  impactFileList,
  rankFilesByFanIn,
  rankFunctionsInFile,
  type FunctionImpactRank,
} from "@/lib/impact";
import type { CodeGraph } from "@/lib/codeAnalysis/types";
import { TOK } from "@/lib/sessionTheme";

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
          title="No test file reaches this dependent's file — a regression here is unguarded"
        >
          <TriangleAlert size={10} /> untested
        </span>
      )}
      {entry.crossModule && (
        <span
          className="shrink-0 text-[10px] uppercase tracking-[0.08em] px-1.5 py-0.5 rounded"
          style={{ background: TOK.amberSoft, color: TOK.amber }}
          title="Lives outside the target's module — a more surprising ripple"
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

function Column({
  title,
  icon,
  entries,
  emptyLabel,
  tested,
  showUntested,
}: {
  title: string;
  icon: React.ReactNode;
  entries: RowEntry[];
  emptyLabel: string;
  tested: Set<string>;
  showUntested: boolean;
}) {
  const sorted = [...entries].sort(
    (a, b) =>
      a.hop - b.hop ||
      a.filePath.localeCompare(b.filePath) ||
      (a.label ?? "").localeCompare(b.label ?? "")
  );
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div
        className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em]"
        style={{ color: TOK.textMuted }}
      >
        {icon}
        <span>
          {title} · {entries.length}
        </span>
      </div>
      {sorted.length === 0 ? (
        <p className="text-[13px] py-2" style={{ color: TOK.textMuted }}>
          {emptyLabel}
        </p>
      ) : (
        <div className="flex flex-col">
          {sorted.slice(0, 60).map((e, i) => (
            <EntryRow
              key={`${e.filePath}:${e.label ?? ""}:${e.hop}:${i}`}
              entry={e}
              untested={showUntested && !tested.has(e.filePath)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ImpactExplorer({ graph }: { graph: CodeGraph }) {
  const tested = useMemo(() => deriveTestedFiles(graph), [graph]);
  const topFiles = useMemo(() => rankFilesByFanIn(graph, 8), [graph]);
  const allFiles = useMemo(() => impactFileList(graph), [graph]);
  const [selected, setSelected] = useState<string | null>(
    topFiles[0]?.file ?? allFiles[0] ?? null
  );
  const [selectedFn, setSelectedFn] = useState<FunctionImpactRank | null>(null);
  const [query, setQuery] = useState("");

  const blast = useMemo(
    () => (selected ? computeBlastRadius(graph, selected) : null),
    [graph, selected]
  );

  // Drill-down candidates: the selected file's functions, most-called first.
  const fnRanks = useMemo(
    () => (selected ? rankFunctionsInFile(graph, selected, 12) : []),
    [graph, selected]
  );

  const fnBlast = useMemo(
    () =>
      selected && selectedFn
        ? computeFunctionBlastRadius(graph, selected, selectedFn.name, {
            targetContainerType: selectedFn.containerType,
          })
        : null,
    [graph, selected, selectedFn]
  );

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

  const untestedCount = incoming.filter((e) => !tested.has(e.filePath)).length;
  const crossModuleCount = incoming.filter((e) => e.crossModule).length;
  const impactedFileCount =
    mode === "function"
      ? new Set(incoming.map((e) => e.filePath)).size
      : incoming.length;
  const truncated = fnBlast ? fnBlast.truncated : blast?.truncated;

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
          Pick a file to see what breaks if you change it — before you touch
          it. Drill into a function for the exact call chain.
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
            placeholder="Search a file…"
            className="flex-1 bg-transparent outline-none text-[13px]"
            style={{ ...MONO, color: TOK.textPrimary }}
          />
        </div>

        {matches.length > 0 ? (
          <div
            className="flex flex-col rounded-lg overflow-hidden"
            style={{ border: `1px solid ${TOK.border}` }}
          >
            {matches.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => pick(f)}
                className="text-left px-3 py-1.5 text-[13px] truncate hover:bg-white/5 transition"
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
                  className="text-[11px] px-2 py-0.5 rounded transition hover:opacity-80"
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
                <div
                  className="inline-flex items-center gap-1.5 text-[15px] font-semibold"
                  style={{ color: TOK.accent }}
                >
                  <ShieldCheck size={16} />
                  {mode === "function"
                    ? "No tracked callers — safe to change in isolation."
                    : "Nothing depends on this — safe to change in isolation."}
                </div>
              ) : (
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span
                    className="text-[17px] font-semibold"
                    style={{ color: TOK.textPrimary }}
                  >
                    {incoming.length}{" "}
                    {mode === "function"
                      ? `function${incoming.length === 1 ? "" : "s"} break`
                      : `file${incoming.length === 1 ? "" : "s"} break`}
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
                    className="text-[11px] px-2 py-0.5 rounded transition hover:opacity-80"
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
              {selectedFn && (
                <button
                  type="button"
                  onClick={() => setSelectedFn(null)}
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded transition hover:opacity-80"
                  style={{
                    border: `1px solid ${TOK.border}`,
                    color: TOK.textMuted,
                  }}
                >
                  <X size={10} /> file view
                </button>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Column
              title="What breaks (depends on this)"
              icon={<ArrowDownToLine size={12} />}
              entries={incoming}
              emptyLabel={
                mode === "function"
                  ? "No resolved calls into this function."
                  : "Nothing imports or calls into this file."
              }
              tested={tested}
              showUntested
            />
            <Column
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
