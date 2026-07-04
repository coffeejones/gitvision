"use client";

// Interactive impact analysis — "what breaks if I change this file?"
//
// The blast-radius engine (computeBlastRadius) is pure over the CodeGraph and
// built to recompute in the client on every selection, so this is a fully
// client-side tool: pick a file → instantly see its incoming set (what depends
// on it, i.e. what breaks) and outgoing set (what it depends on), grouped by
// hop distance, with the two risk signals the analysis already knows —
// cross-module callers and, crucially, dependents that HAVE NO TEST.
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
} from "lucide-react";
import {
  computeBlastRadius,
  type BlastRadiusEntry,
} from "@/lib/codeAnalysis/blastRadius";
import {
  deriveTestedFiles,
  impactFileList,
  rankFilesByFanIn,
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

function EntryRow({
  entry,
  untested,
}: {
  entry: BlastRadiusEntry;
  untested?: boolean;
}) {
  return (
    <div
      className="flex items-center gap-2 py-1.5 px-2 rounded text-[13px]"
      style={{ borderBottom: `1px solid ${TOK.border}` }}
    >
      <span
        className="truncate flex-1 min-w-0"
        style={{ ...MONO, color: TOK.textSecondary }}
        title={entry.filePath}
      >
        {entry.filePath}
      </span>
      {untested && (
        <span
          className="shrink-0 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.08em] px-1.5 py-0.5 rounded"
          style={{ background: TOK.roseSoft, color: TOK.rose }}
          title="No test file reaches this dependent — a regression here is unguarded"
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
  entries: BlastRadiusEntry[];
  emptyLabel: string;
  tested: Set<string>;
  showUntested: boolean;
}) {
  const sorted = [...entries].sort(
    (a, b) => a.hop - b.hop || a.filePath.localeCompare(b.filePath)
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
          {sorted.slice(0, 60).map((e) => (
            <EntryRow
              key={`${e.filePath}:${e.hop}`}
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
  const [query, setQuery] = useState("");

  const blast = useMemo(
    () => (selected ? computeBlastRadius(graph, selected) : null),
    [graph, selected]
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return allFiles.filter((f) => f.toLowerCase().includes(q)).slice(0, 40);
  }, [query, allFiles]);

  const untestedCount = blast
    ? blast.incoming.filter((e) => !tested.has(e.filePath)).length
    : 0;

  function pick(file: string) {
    setSelected(file);
    setQuery("");
  }

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
          Pick a file to see what breaks if you change it — before you touch it.
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
                <span style={{ ...MONO, color: TOK.textPrimary }}>
                  {selected}
                </span>
              </div>
              {blast.incoming.length === 0 ? (
                <div
                  className="inline-flex items-center gap-1.5 text-[15px] font-semibold"
                  style={{ color: TOK.accent }}
                >
                  <ShieldCheck size={16} /> Nothing depends on this — safe to
                  change in isolation.
                </div>
              ) : (
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span
                    className="text-[17px] font-semibold"
                    style={{ color: TOK.textPrimary }}
                  >
                    {blast.incoming.length} file
                    {blast.incoming.length === 1 ? "" : "s"} break
                  </span>
                  <span className="text-[13px]" style={{ color: TOK.textMuted }}>
                    {blast.crossModuleCounts.incoming} cross-module
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Column
              title="What breaks (depends on this)"
              icon={<ArrowDownToLine size={12} />}
              entries={blast.incoming}
              emptyLabel="Nothing imports or calls into this file."
              tested={tested}
              showUntested
            />
            <Column
              title="What it depends on"
              icon={<ArrowUpFromLine size={12} />}
              entries={blast.outgoing}
              emptyLabel="This file doesn't import or call into anything tracked."
              tested={tested}
              showUntested={false}
            />
          </div>

          {blast.truncated && (
            <p className="text-[11px]" style={{ color: TOK.textMuted }}>
              {blast.truncated}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
