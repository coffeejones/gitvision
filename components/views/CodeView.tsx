// Presentational read-only code renderer for the Source view. Takes already-
// highlighted lines (from lib/highlight) and draws them with a sticky line-number
// gutter + a reserved marker slot per line (Stage 3 fills it with the per-line
// analysis annotations). No fetching, no highlighting — pure render, so it's
// harness-/snapshot-friendly.

import { AlertTriangle } from "lucide-react";
import { TOK } from "@/lib/sessionTheme";
import type { CodeLines } from "@/lib/highlight";

const LINE_HEIGHT = 20;

export function CodeView({
  path,
  lines,
  aligned,
  lang,
  /** Optional per-line marker (1-indexed line → node). Stage 3 supplies these. */
  markerForLine,
}: {
  path: string;
  lines: CodeLines;
  aligned: boolean;
  lang: string | null;
  markerForLine?: (line: number) => React.ReactNode;
}) {
  return (
    <div className="flex flex-col min-w-0">
      {/* File header — path + language. Analysis chips land here in Stage 3. */}
      <div
        className="flex items-center gap-3 px-4 h-10 flex-shrink-0"
        style={{ borderBottom: `1px solid ${TOK.border}`, background: TOK.surfaceElevated }}
      >
        <span
          className="text-[12.5px] font-medium truncate"
          style={{ color: TOK.textPrimary, fontFamily: "var(--font-mono)" }}
        >
          {path}
        </span>
        {lang && (
          <span
            className="text-[10px] uppercase tracking-[0.12em] px-1.5 py-0.5 rounded flex-shrink-0"
            style={{ color: TOK.textMuted, background: "rgba(255,255,255,0.04)" }}
          >
            {lang}
          </span>
        )}
      </div>

      {/* Drift banner — the fetched bytes don't hash to what we analyzed, so any
          line-anchored marker would point at the wrong line. Show the code, drop
          the alignment claim. */}
      {!aligned && (
        <div
          className="flex items-start gap-2 px-4 py-2 text-[12px] flex-shrink-0"
          style={{ background: "rgba(210,153,34,0.08)", color: TOK.amber, borderBottom: `1px solid ${TOK.border}` }}
        >
          <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
          <span>
            This file changed since we analyzed it — showing the current source,
            but line-anchored markers are hidden. Refresh the session to re-align.
          </span>
        </div>
      )}

      {/* Code — one horizontal scroll region; the line-number gutter sticks left. */}
      <div className="overflow-x-auto" style={{ background: TOK.surface }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>
          {lines.map((toks, i) => {
            const lineNo = i + 1;
            return (
              <div
                key={i}
                className="flex items-stretch"
                style={{ minWidth: "max-content", height: LINE_HEIGHT }}
              >
                <span
                  className="text-right select-none flex-shrink-0"
                  style={{
                    position: "sticky",
                    left: 0,
                    width: 52,
                    paddingRight: 12,
                    color: TOK.textMuted,
                    background: TOK.surface,
                    lineHeight: `${LINE_HEIGHT}px`,
                  }}
                >
                  {lineNo}
                </span>
                <span
                  className="flex items-center justify-center select-none flex-shrink-0"
                  style={{ width: 18, background: TOK.surface, position: "sticky", left: 52 }}
                >
                  {markerForLine?.(lineNo)}
                </span>
                <code style={{ whiteSpace: "pre", lineHeight: `${LINE_HEIGHT}px`, paddingRight: 24 }}>
                  {toks.length === 0 ? (
                    "​"
                  ) : (
                    toks.map((t, j) => (
                      <span key={j} style={t.color ? { color: t.color } : undefined}>
                        {t.content}
                      </span>
                    ))
                  )}
                </code>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
