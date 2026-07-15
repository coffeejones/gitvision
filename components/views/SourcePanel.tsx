"use client";

// The Source view container: file tree on the left, read-only code on the right.
// Clicking a file fetches its source from the gated Stage-1 route (live from
// GitHub, pinned to the analyzed commit, never stored), highlights it client-
// side, and renders it. Deep-linkable via ?file= so the other Forensics surfaces
// can jump straight to a line (wired in a later stage).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FileSearch, Loader2, TriangleAlert } from "lucide-react";
import { TOK } from "@/lib/sessionTheme";
import { buildFileTree, defaultExpanded } from "@/lib/fileTree";
import { highlightToLines, type CodeLines } from "@/lib/highlight";
import type { FileChips, FnMarker } from "@/lib/sourceAnnotations";
import { SourceTree } from "./SourceTree";
import { CodeView } from "./CodeView";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "loaded";
      path: string;
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
}: {
  sessionId: string;
  files: string[];
  chips: Record<string, FileChips>;
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

  // Follow a deep-link that lands while we're already mounted (a soft nav from
  // another Forensics surface changes ?file= without remounting).
  useEffect(() => {
    if (linked && files.includes(linked)) setSelected(linked);
  }, [linked, files]);

  useEffect(() => {
    if (!selected) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
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

  const onSelect = useCallback((path: string) => setSelected(path), []);

  return (
    <div
      className="flex rounded-xl overflow-hidden"
      style={{ height: 720, border: `1px solid ${TOK.border}`, background: TOK.surface }}
    >
      {/* File tree */}
      <aside
        className="flex-shrink-0 overflow-y-auto"
        style={{ width: 288, borderRight: `1px solid ${TOK.border}`, background: TOK.surfaceElevated }}
      >
        <div
          className="sticky top-0 z-10 px-3 h-9 flex items-center text-[10px] uppercase tracking-[0.16em]"
          style={{ color: TOK.textMuted, background: TOK.surfaceElevated, borderBottom: `1px solid ${TOK.border}` }}
        >
          {files.length} files
        </div>
        <SourceTree nodes={tree} selected={selected} onSelect={onSelect} defaultOpen={defaultOpen} />
      </aside>

      {/* Code pane */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {state.status === "idle" && <Centered icon={<FileSearch size={26} />} title="Pick a file to read it" body="Every file we analyzed is here. Open one to see its source with CodeTrawl's findings on it." />}
        {state.status === "loading" && <Centered icon={<Loader2 size={22} className="animate-spin" />} title="Fetching source…" body="Live from GitHub, pinned to the commit we analyzed." />}
        {state.status === "error" && <Centered icon={<TriangleAlert size={24} />} title="Couldn't load this file" body={state.message} tone="warn" />}
        {state.status === "loaded" && (
          <CodeView
            sessionId={sessionId}
            path={state.path}
            lines={state.lines}
            aligned={state.aligned}
            lang={state.lang}
            chips={chips[state.path] ?? null}
            functions={state.functions}
            focusLine={state.path === linked ? linkedLine : null}
          />
        )}
      </div>
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
