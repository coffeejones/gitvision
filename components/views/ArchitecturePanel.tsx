"use client";

// Architecture tab — class diagram surface (v0.72).
//
// Stacked layout:
//   1. Interactive ReactFlow canvas (primary — the browsing UX)
//   2. "Show Mermaid source" toggle revealing the source block +
//      "Copy as Mermaid" CTA (secondary — the shareability path)
//
// Three render states above the stack:
//   - No codeGraph at all → degraded empty state (skip reason if
//     present, else "Refresh" prompt for legacy snapshots)
//   - codeGraph exists but no classes detected → friendly
//     "no classes" state (common for utility-heavy repos)
//   - Classes detected → eyebrow row + scope dropdown + the stack
//
// The Mermaid source path stayed because it's still the best
// shareability format (paste into README, blog post, or
// mermaid.live), but the in-app browsing happens on the
// interactive canvas — that's where the new UX lives.

import { useState } from "react";
import { Boxes, Check, ChevronDown, ChevronRight, Copy } from "lucide-react";
import type { CodeGraph } from "@/lib/types";
import type {
  ClassDiagramResult,
  ScopeOption,
} from "@/lib/intelligence/classDiagram";
import { STYLE, TOK } from "@/lib/theme";
import { ArchitectureScope } from "./ArchitectureScope";
import { ClassCanvas } from "./ClassCanvas";
import { HelpHint } from "@/components/HelpHint";

interface Props {
  diagram: ClassDiagramResult | null;
  codeGraph?: CodeGraph;
  codeGraphSkipReason?: string;
  /** Folders sorted by class-count for the scope dropdown. Server-
   *  computed via computeScopeOptions(cg). Empty when there are no
   *  classes — dropdown hides itself in that case. */
  scopeOptions?: ScopeOption[];
  /** Currently-applied scope folder. Empty string = "all". */
  currentScope?: string;
}

export function ArchitecturePanel({
  diagram,
  codeGraph,
  codeGraphSkipReason,
  scopeOptions = [],
  currentScope = "",
}: Props) {
  if (!codeGraph) {
    return <EmptyCodeGraph reason={codeGraphSkipReason} />;
  }
  // We may still want to render the scope dropdown even when the
  // current scope yielded zero classes (so the user can switch
  // back to "All"). Only hide the whole panel when there are no
  // classes ANYWHERE in the repo.
  const totalClassesInRepo = diagram?.totalAvailable ?? 0;
  if (totalClassesInRepo === 0) {
    return <EmptyClasses totalAvailable={0} />;
  }

  // Build canvas-scope from the currently-applied folder. Empty
  // string = "all"; same convention as the URL search param.
  const canvasScope = currentScope
    ? ({ kind: "folder", folder: currentScope } as const)
    : ({ kind: "all" } as const);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span
            className={`${STYLE.eyebrow} inline-flex items-center gap-1.5`}
            style={{ color: TOK.textMuted }}
          >
            Class diagram
            <HelpHint
              anchor="architecture"
              label="Class canvas, edge types, and filters"
            />
          </span>
          {diagram && (
            <span className="text-xs" style={{ color: TOK.textMuted }}>
              · {diagram.classCount} class
              {diagram.classCount === 1 ? "" : "es"}
              {currentScope === "" &&
                diagram.totalAvailable > diagram.classCount &&
                ` of ${diagram.totalAvailable}`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {scopeOptions.length > 0 && (
            <ArchitectureScope
              options={scopeOptions}
              totalClasses={totalClassesInRepo}
              currentScope={currentScope}
            />
          )}
        </div>
      </div>

      {diagram && diagram.classCount > 0 ? (
        <>
          {/* Primary: interactive canvas. Drag/zoom/pan, click a
           *  class to highlight neighbours, hover for the file
           *  path tooltip. */}
          <ClassCanvas codeGraph={codeGraph} scope={canvasScope} />

          {diagram.truncated && (
            <p className="text-[11px]" style={{ color: TOK.textMuted }}>
              {diagram.truncated}
            </p>
          )}

          {/* Secondary: collapsible Mermaid source for distribution.
           *  Hidden by default — it's not the browsing surface, just
           *  a "give me the text I can paste into mermaid.live or
           *  README" affordance. */}
          <MermaidSourceDisclosure source={diagram.source} />
        </>
      ) : (
        // Scope filter matched zero classes — but classes exist
        // somewhere in the repo. Surface as a soft empty-state
        // INSIDE the panel so the dropdown stays accessible for
        // the user to switch back to "All".
        <div
          className="rounded-xl border border-dashed p-8 text-center text-sm"
          style={{ borderColor: TOK.border, color: TOK.textMuted }}
        >
          No classes in <code className="font-mono">{currentScope}</code>.
          Pick a different scope from the dropdown above.
        </div>
      )}
    </section>
  );
}

/** v0.72: collapsible disclosure for the Mermaid source block. The
 *  source is no longer the primary surface (the interactive canvas
 *  is), but it's still useful as a shareability/export affordance. */
function MermaidSourceDisclosure({ source }: { source: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-xs inline-flex items-center gap-1 px-2 py-1 -ml-2 rounded-md transition cursor-pointer"
          style={{ color: TOK.textSecondary }}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {open ? "Hide" : "Show"} Mermaid source
        </button>
        {open && <CopyButton source={source} />}
      </div>
      {open && (
        <pre
          className="rounded-xl p-4 text-[12px] leading-relaxed font-mono overflow-x-auto"
          style={{
            background: TOK.surface,
            border: `1px solid ${TOK.border}`,
            color: TOK.textPrimary,
          }}
        >
          {source}
        </pre>
      )}
    </div>
  );
}

function CopyButton({ source }: { source: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    try {
      navigator.clipboard.writeText(source).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      });
    } catch {
      // Clipboard API blocked (insecure context, browser
      // restrictions). User can still select-all the <pre> manually.
    }
  }
  return (
    <button
      onClick={copy}
      className="text-xs inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md transition cursor-pointer"
      style={{
        background: copied ? TOK.accentSoft : TOK.surface,
        color: copied ? TOK.accent : TOK.textSecondary,
        border: `1px solid ${copied ? `${TOK.accent}44` : TOK.border}`,
      }}
    >
      {copied ? (
        <>
          <Check size={11} />
          Copied
        </>
      ) : (
        <>
          <Copy size={11} />
          Copy as Mermaid
        </>
      )}
    </button>
  );
}

function EmptyCodeGraph({ reason }: { reason?: string }) {
  const isSkipped = !!reason;
  return (
    <div
      className="rounded-xl border border-dashed p-10 text-center text-sm flex flex-col items-center gap-3"
      style={{ borderColor: TOK.border, color: TOK.textMuted }}
    >
      <Boxes size={20} style={{ color: TOK.textSecondary }} />
      {isSkipped ? (
        <>
          <p style={{ color: TOK.textSecondary }}>
            Class extraction was skipped for this snapshot.
          </p>
          <p className="max-w-2xl">{reason}</p>
        </>
      ) : (
        <>
          <p style={{ color: TOK.textSecondary }}>
            This snapshot was created before the class-extraction
            pipeline shipped.
          </p>
          <p>
            Click{" "}
            <strong style={{ color: TOK.textPrimary }}>Refresh</strong>{" "}
            in the topbar to populate it. v0.70+ snapshots ship with
            JavaScript / TypeScript class data; other languages
            follow in upcoming versions.
          </p>
        </>
      )}
    </div>
  );
}

function EmptyClasses({ totalAvailable }: { totalAvailable: number }) {
  return (
    <div
      className="rounded-xl border border-dashed p-10 text-center text-sm flex flex-col items-center gap-2"
      style={{ borderColor: TOK.border, color: TOK.textMuted }}
    >
      <Boxes size={20} style={{ color: TOK.textSecondary }} />
      <p style={{ color: TOK.textSecondary }}>
        {totalAvailable === 0
          ? "No classes detected in this repo's JS/TS sources."
          : "No classes match the current scope."}
      </p>
      <p className="text-[11px] max-w-xl">
        Many modern JS/TS codebases lean functional and have few or
        no classes. Class extraction for Python, Go, Java, C#, PHP,
        and Ruby is rolling out in the next phase — those repos
        will surface more here.
      </p>
    </div>
  );
}

