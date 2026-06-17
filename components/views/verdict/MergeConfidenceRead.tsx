// The Read — Merge Confidence card (Mode B). Presentational only: the
// MergeConfidenceRead object is computed server-side by
// lib/intelligence/mergeConfidenceRead.ts and passed in. Turns a PR's
// base->head diff into one call — SAFE TO MERGE / REVIEW CLOSELY / HIGH BLAST —
// the explorable "why" behind the terse PR-bot comment.
//
// Orange (TOK.rose) is rationed exactly like the adoption card: it appears only
// on a HIGH BLAST verdict word + the single critical (top-risk) function.
// SAFE reads in bone, REVIEW in the dim amber tone.

import { Check, AlertTriangle } from "lucide-react";
import { TOK } from "@/lib/sessionTheme";
import type {
  MergeConfidenceRead,
  MergeConfidenceLevel,
  RiskyFunction,
} from "@/lib/intelligence/mergeConfidenceRead";

const READ_COLOR: Record<MergeConfidenceLevel, string> = {
  "SAFE TO MERGE": TOK.accent,
  "REVIEW CLOSELY": TOK.amber,
  "HIGH BLAST": TOK.rose,
};

// Suggestion severity reads in TONE, never hue — orange stays rationed.
const SEV_COLOR: Record<string, string> = {
  critical: TOK.textPrimary,
  warning: TOK.amber,
  info: TOK.textMuted,
};

const MONO = { fontFamily: "var(--font-mono)" } as const;

function RiskyRow({ fn, critical }: { fn: RiskyFunction; critical?: boolean }) {
  const dot = critical
    ? TOK.rose
    : fn.untested
      ? TOK.textSecondary
      : TOK.textMuted;
  const stats = [
    `${fn.callers} caller${fn.callers === 1 ? "" : "s"}`,
    fn.crossModule > 0 ? `${fn.crossModule} cross-module` : null,
    `cx ${fn.complexity}`,
    fn.untested ? "no test reaches it" : "test-covered",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex gap-3">
      <span
        className="shrink-0 rounded-full"
        style={{ width: 8, height: 8, marginTop: 6, background: dot }}
      />
      <div className="min-w-0">
        <div className="text-[13.5px] leading-snug" style={{ color: TOK.textPrimary }}>
          <span style={MONO}>
            {fn.containerType ? `${fn.containerType}.` : ""}
            {fn.name}
          </span>
          <span style={{ color: TOK.textMuted }}> · {fn.status}</span>
        </div>
        <div className="text-[12px] truncate" style={{ color: TOK.textMuted }}>
          {fn.filePath}
        </div>
        <div
          className="text-[11.5px] mt-0.5"
          style={{ ...MONO, color: critical ? TOK.rose : TOK.textMuted }}
        >
          {stats}
        </div>
      </div>
    </div>
  );
}

export function MergeConfidenceReadCard({ read }: { read: MergeConfidenceRead }) {
  const headColor = READ_COLOR[read.read];
  const s = read.summary;
  const touched = s.functionsAdded + s.functionsModified + s.functionsRemoved;
  const net =
    s.netComplexityDelta === 0
      ? "±0"
      : `${s.netComplexityDelta > 0 ? "+" : ""}${s.netComplexityDelta}`;

  return (
    <section
      className="flex flex-col gap-5 rounded-xl p-6"
      style={{ background: TOK.surface, border: `1px solid ${TOK.border}` }}
      aria-label={`The Read — merge confidence: ${read.read}`}
    >
      {/* Eyebrow + diff-summary chip */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <span
            className="shrink-0 rounded-full"
            style={{ width: 7, height: 7, background: headColor }}
          />
          <span
            className="text-[10px] uppercase tracking-[0.2em] font-medium"
            style={{ color: TOK.textMuted }}
          >
            The read · merge confidence
          </span>
        </div>
        <div
          className="text-center rounded-lg shrink-0"
          style={{ border: `1px solid ${TOK.border}`, padding: "7px 12px" }}
        >
          <div
            className="text-[20px] font-semibold leading-none"
            style={{ color: TOK.textSecondary }}
          >
            {touched}
          </div>
          <div
            className="text-[9px] tracking-[0.14em] mt-1.5"
            style={{ ...MONO, color: TOK.textMuted }}
          >
            TOUCHED
          </div>
        </div>
      </div>

      {/* Hero verdict + headline */}
      <div className="flex items-baseline gap-4 flex-wrap">
        <span
          className="text-[40px] font-semibold leading-none"
          style={{ color: headColor, letterSpacing: "0.01em" }}
        >
          {read.read}
        </span>
        <span
          className="text-[14.5px] leading-relaxed flex-1"
          style={{ color: TOK.textSecondary, minWidth: 220 }}
        >
          {read.headline}
        </span>
      </div>
      <div className="text-[12px]" style={{ ...MONO, color: TOK.textMuted }}>
        {s.filesChanged} file{s.filesChanged === 1 ? "" : "s"} · +{s.functionsAdded}{" "}
        ~{s.functionsModified} −{s.functionsRemoved} · net complexity {net}
      </div>

      <div style={{ height: 1, background: TOK.border }} />

      {/* Riskiest touched functions */}
      <div className="flex flex-col gap-3.5">
        <div
          className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] font-medium"
          style={{ color: TOK.textMuted }}
        >
          <AlertTriangle size={14} style={{ color: headColor }} aria-hidden />
          Riskiest changes
        </div>
        {read.riskiest.length > 0 ? (
          read.riskiest.map((fn) => (
            <RiskyRow
              key={fn.key}
              fn={fn}
              critical={fn.key === read.criticalFnKey}
            />
          ))
        ) : (
          <span className="text-[13px]" style={{ color: TOK.textMuted }}>
            No function-level changes between these refs.
          </span>
        )}
        {read.safeParts && (
          <div
            className="flex items-center gap-2 text-[12.5px] mt-1"
            style={{ color: TOK.textMuted }}
          >
            <Check size={13} style={{ color: TOK.accent }} aria-hidden />
            {read.safeParts}
          </div>
        )}
        {read.truncatedNote && (
          <span className="text-[11.5px]" style={{ color: TOK.textMuted }}>
            {read.truncatedNote}
          </span>
        )}
      </div>

      {/* Suggested verification — the PR-bot's own prioritized list, expanded */}
      {read.suggestions.length > 0 && (
        <>
          <div style={{ height: 1, background: TOK.border }} />
          <div className="flex flex-col gap-3">
            <span
              className="text-[10px] uppercase tracking-[0.18em] font-medium"
              style={{ color: TOK.textMuted }}
            >
              Suggested verification
            </span>
            {read.suggestions.map((sug, i) => (
              <div key={i} className="flex gap-3">
                <span
                  className="shrink-0 rounded-full"
                  style={{
                    width: 8,
                    height: 8,
                    marginTop: 6,
                    background: SEV_COLOR[sug.severity] ?? TOK.textMuted,
                  }}
                />
                <span
                  className="text-[13.5px] leading-relaxed"
                  style={{ color: TOK.textSecondary }}
                >
                  {sug.text}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Trust line */}
      <p
        className="text-[10.5px] leading-relaxed"
        style={{ ...MONO, color: TOK.textMuted, letterSpacing: "0.03em" }}
      >
        computed from the base→head diff · blast radius + test coverage · not AI
      </p>
    </section>
  );
}
