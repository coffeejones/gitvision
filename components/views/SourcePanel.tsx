"use client";

// The Source view container: file tree on the left, read-only code on the right.
// Clicking a file fetches its source from the gated Stage-1 route (live from
// GitHub, pinned to the analyzed commit, never stored), highlights it client-
// side, and renders it. Deep-linkable via ?file= so the other Forensics surfaces
// can jump straight to a line (wired in a later stage).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FileSearch, Loader2, TriangleAlert, Search, X, FileCode2, Braces } from "lucide-react";
import { TOK } from "@/lib/sessionTheme";
import { buildFileTree, defaultExpanded } from "@/lib/fileTree";
import { highlightToLines, type CodeLines } from "@/lib/highlight";
import type { FileChips, FnMarker } from "@/lib/sourceAnnotations";
import { searchSources, type SearchSymbol, type SearchResult } from "@/lib/symbolSearch";
import { SourceTree } from "./SourceTree";
import { CodeView } from "./CodeView";
import { WhatIfEditor } from "./WhatIfEditor";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "loaded";
      path: string;
      content: string;
      lines: CodeLines;
      lang: string | null;
      aligned: boolean;
      functions: FnMarker[];
    }
  | { status: "error"; message: string };

export function SourcePanel({
  sessionId,
  files,
  chips,
  symbols = [],
  repoPrivate = false,
}: {
  sessionId: string;
  files: string[];
  chips: Record<string, FileChips>;
  /** Every analyzed function, for the finder's jump-to-definition. */
  symbols?: SearchSymbol[];
  /** Threaded to the AI explainer for the one-time private-repo consent. */
  repoPrivate?: boolean;
}) {
  const tree = useMemo(() => buildFileTree(files), [files]);
  const defaultOpen = useMemo(() => defaultExpanded(tree), [tree]);

  const searchParams = useSearchParams();
  const linked = searchParams.get("file");
  const linkedLine = Number(searchParams.get("line")) || null;
  const [selected, setSelected] = useState<string | null>(
    linked && files.includes(linked) ? linked : null,
  );
  const [state, setState] = useState<LoadState>({ status: "idle" });
  // Read-only vs the what-if scratch editor. Resets whenever the file changes.
  const [mode, setMode] = useState<"read" | "edit">("read");

  // Finder — fuzzy-jump to any file or function. When the query is non-empty it
  // replaces the tree with ranked results; picking a symbol jumps to its line.
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [pendingFocus, setPendingFocus] = useState<{ path: string; line: number } | null>(null);
  const results = useMemo(
    () => searchSources(query, files, symbols, 50),
    [query, files, symbols],
  );
  useEffect(() => setActiveIdx(0), [query]);

  // Follow a deep-link that lands while we're already mounted (a soft nav from
  // another Forensics surface changes ?file= without remounting).
  useEffect(() => {
    if (linked && files.includes(linked)) setSelected(linked);
  }, [linked, files]);

  // A fresh URL deep-link (?file&line, e.g. a callee/twin panel jump) takes over
  // from any earlier finder jump — otherwise a stale pendingFocus for the same
  // file would shadow it (and, being the same number, wouldn't even re-scroll).
  useEffect(() => {
    setPendingFocus(null);
  }, [linked, linkedLine]);

  useEffect(() => {
    if (!selected) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setMode("read"); // switching files always returns to read-only
    setState({ status: "loading" });
    (async () => {
      try {
        const res = await fetch(
          `/api/sessions/${sessionId}/source?path=${encodeURIComponent(selected)}`,
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `Couldn't load this file (HTTP ${res.status}).`);
        }
        const data = (await res.json()) as {
          path: string;
          content: string;
          ext: string;
          aligned: boolean;
          functions?: FnMarker[];
        };
        const { lines, lang } = await highlightToLines(data.content, data.ext);
        if (!cancelled) {
          setState({
            status: "loaded",
            path: data.path,
            content: data.content,
            lines,
            lang,
            aligned: data.aligned,
            functions: data.functions ?? [],
          });
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Couldn't load this file.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, sessionId]);

  const onSelect = useCallback((path: string) => {
    setPendingFocus(null); // a tree click is a plain open, no line jump
    setSelected(path);
  }, []);

  // Open a finder result — a file plainly, a symbol with a jump to its line —
  // then close the finder back to the tree.
  const selectResult = useCallback((r: SearchResult) => {
    setPendingFocus(r.kind === "symbol" && r.line != null ? { path: r.path, line: r.line } : null);
    setSelected(r.path);
    setQuery("");
    setActiveIdx(0);
  }, []);

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const r = results[activeIdx];
      if (r) selectResult(r);
    } else if (e.key === "Escape") {
      setQuery("");
      setActiveIdx(0);
    }
  }

  // The line to focus: a pending finder jump wins over the URL deep-link.
  const focusLine =
    state.status === "loaded" && pendingFocus?.path === state.path
      ? pendingFocus.line
      : state.status === "loaded" && state.path === linked
        ? linkedLine
        : null;

  return (
    <div
      className="flex rounded-xl overflow-hidden"
      style={{ height: 720, border: `1px solid ${TOK.border}`, background: TOK.surface }}
    >
      {/* File tree / finder */}
      <aside
        className="flex-shrink-0 overflow-y-auto"
        style={{ width: 288, borderRight: `1px solid ${TOK.border}`, background: TOK.surfaceElevated }}
      >
        <div
          className="sticky top-0 z-10 px-2.5 h-9 flex items-center gap-2"
          style={{ background: TOK.surfaceElevated, borderBottom: `1px solid ${TOK.border}` }}
        >
          <Search size={13} className="flex-shrink-0" style={{ color: TOK.textMuted }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="Find file or function…"
            spellCheck={false}
            className="flex-1 min-w-0 bg-transparent text-[12px] outline-none placeholder:opacity-60"
            style={{ color: TOK.textPrimary }}
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              title="Clear"
              className="flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded transition hover:bg-white/10"
              style={{ color: TOK.textMuted }}
            >
              <X size={12} />
            </button>
          ) : (
            <span className="flex-shrink-0 text-[10px] tabular-nums" style={{ color: TOK.textMuted }}>
              {files.length}
            </span>
          )}
        </div>
        {query ? (
          <SearchResults
            results={results}
            activeIdx={activeIdx}
            onPick={selectResult}
            onHover={setActiveIdx}
          />
        ) : (
          <SourceTree nodes={tree} selected={selected} onSelect={onSelect} defaultOpen={defaultOpen} />
        )}
      </aside>

      {/* Code pane */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {state.status === "idle" && <Centered icon={<FileSearch size={26} />} title="Pick a file to read it" body="Every file we analyzed is here. Open one to see its source with CodeTrawl's findings on it." />}
        {state.status === "loading" && <Centered icon={<Loader2 size={22} className="animate-spin" />} title="Fetching source…" body="Live from GitHub, pinned to the commit we analyzed." />}
        {state.status === "error" && <Centered icon={<TriangleAlert size={24} />} title="Couldn't load this file" body={state.message} tone="warn" />}
        {state.status === "loaded" &&
          (mode === "edit" ? (
            <WhatIfEditor
              sessionId={sessionId}
              path={state.path}
              initialContent={state.content}
              onExit={() => setMode("read")}
            />
          ) : (
            <CodeView
              sessionId={sessionId}
              path={state.path}
              lines={state.lines}
              aligned={state.aligned}
              lang={state.lang}
              chips={chips[state.path] ?? null}
              functions={state.functions}
              focusLine={focusLine}
              onEdit={state.aligned ? () => setMode("edit") : undefined}
              repoPrivate={repoPrivate}
            />
          ))}
      </div>
    </div>
  );
}

function SearchResults({
  results,
  activeIdx,
  onPick,
  onHover,
}: {
  results: SearchResult[];
  activeIdx: number;
  onPick: (r: SearchResult) => void;
  onHover: (i: number) => void;
}) {
  if (results.length === 0) {
    return (
      <div className="px-3 py-6 text-[12px] text-center" style={{ color: TOK.textMuted }}>
        No files or functions match.
      </div>
    );
  }
  return (
    <div className="py-1">
      {results.map((r, i) => {
        const active = i === activeIdx;
        return (
          <button
            key={`${r.kind}:${r.path}:${r.line ?? ""}:${r.primary}`}
            type="button"
            onClick={() => onPick(r)}
            onMouseEnter={() => onHover(i)}
            className="w-full text-left flex items-center gap-2 px-3 py-1.5 transition"
            style={{ background: active ? "rgba(255,255,255,0.06)" : "transparent" }}
          >
            {r.kind === "symbol" ? (
              <Braces size={13} className="flex-shrink-0" style={{ color: TOK.accent }} />
            ) : (
              <FileCode2 size={13} className="flex-shrink-0" style={{ color: TOK.textMuted }} />
            )}
            <span className="flex-1 min-w-0">
              <span
                className="block text-[12px] truncate"
                style={{
                  color: TOK.textPrimary,
                  fontFamily: r.kind === "symbol" ? "var(--font-mono)" : undefined,
                }}
              >
                {r.primary}
                {r.kind === "symbol" ? "()" : ""}
              </span>
              <span className="block text-[10.5px] truncate" style={{ color: TOK.textMuted }}>
                {r.kind === "symbol" ? `${r.secondary}:${r.line}` : r.secondary}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Centered({
  icon,
  title,
  body,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  tone?: "warn";
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 px-8 text-center">
      <div style={{ color: tone === "warn" ? TOK.amber : TOK.textMuted }}>{icon}</div>
      <div className="text-[15px] font-medium" style={{ color: TOK.textPrimary }}>
        {title}
      </div>
      <div className="text-[13px] max-w-sm leading-relaxed" style={{ color: TOK.textSecondary }}>
        {body}
      </div>
    </div>
  );
}
