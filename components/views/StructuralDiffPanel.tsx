// "Structural changes since last visit" panel for the Overview
// (v0.67 / C2).
//
// Sits between SinceLastVisit (aggregate-level diffs: commits,
// contributors, hotspot rank shifts) and the Headline finding
// (single-most-actionable signal). Answers the next-zoom-level
// question: "Which specific functions / files / dup-groups changed
// since I was here last?".
//
// Driven by lib/intelligence/structuralDiff.ts. The component is a
// thin renderer — empty-state handling lives in the parent (which
// uses structuralDiffHasContent before deciding to render at all).

import {
  ArrowDown,
  ArrowUp,
  Code as CodeIcon,
  Minus,
  Plus,
  ShieldCheck,
} from "lucide-react";
import type {
  ComplexityShift,
  StructuralDiff,
  StructuralFnRef,
} from "@/lib/intelligence/structuralDiff";
import { STYLE, TOK } from "@/lib/sessionTheme";
import { HelpHint } from "@/components/HelpHint";

interface Props {
  diff: StructuralDiff;
}

export function StructuralDiffPanel({ diff }: Props) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span
          className={`${STYLE.eyebrow} inline-flex items-center gap-1.5`}
          style={{ color: TOK.textMuted }}
        >
          Structural changes
          <HelpHint
            anchor="sessions-snapshots"
            label="What snapshots are and how the diff is computed"
          />
        </span>
        <span className="text-xs" style={{ color: TOK.textMuted }}>
          · functions, dup-groups, coverage, complexity since previous snapshot
        </span>
      </div>

      <div
        className="rounded-xl p-5 flex flex-col gap-5"
        style={{
          background: `linear-gradient(135deg, ${TOK.surfaceElevated} 0%, ${TOK.surface} 60%)`,
          border: `1px solid ${TOK.border}`,
          boxShadow:
            "0 1px 2px rgba(0, 0, 0, 0.15), 0 8px 24px -12px rgba(0, 0, 0, 0.35)",
        }}
      >
        <SummaryStrip diff={diff} />

        {(diff.functionsAdded.length > 0 || diff.functionsRemoved.length > 0) && (
          <div className="grid md:grid-cols-2 gap-4">
            {diff.functionsAdded.length > 0 && (
              <FunctionList
                title="Functions added"
                total={diff.totalAdded}
                items={diff.functionsAdded}
                accent={TOK.accent}
                Icon={Plus}
              />
            )}
            {diff.functionsRemoved.length > 0 && (
              <FunctionList
                title="Functions removed"
                total={diff.totalRemoved}
                items={diff.functionsRemoved}
                accent={TOK.rose}
                Icon={Minus}
              />
            )}
          </div>
        )}

        {(diff.complexityWorsened.length > 0 ||
          diff.complexityImproved.length > 0) && (
          <div className="grid md:grid-cols-2 gap-4">
            {diff.complexityWorsened.length > 0 && (
              <ComplexityList
                title="Files getting more complex"
                items={diff.complexityWorsened}
                accent={TOK.amber}
                Icon={ArrowUp}
              />
            )}
            {diff.complexityImproved.length > 0 && (
              <ComplexityList
                title="Files simplified"
                items={diff.complexityImproved}
                accent={TOK.accent}
                Icon={ArrowDown}
              />
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/** Top-of-panel chip strip. Concentrates the "headline numbers"
 *  (added/removed counts, dup-group net change, coverage delta) so
 *  scanners get the gist before reading the lists below. Each chip
 *  hides itself when its number is zero / null — the strip never
 *  shows empty zero-deltas. */
function SummaryStrip({ diff }: { diff: StructuralDiff }) {
  return (
    <div className="flex flex-wrap gap-2">
      {diff.totalAdded > 0 && (
        <Chip
          icon={<Plus size={11} />}
          accent={TOK.accent}
          label={
            <>
              <strong>{diff.totalAdded}</strong> function
              {diff.totalAdded === 1 ? "" : "s"} added
            </>
          }
        />
      )}
      {diff.totalRemoved > 0 && (
        <Chip
          icon={<Minus size={11} />}
          accent={TOK.rose}
          label={
            <>
              <strong>{diff.totalRemoved}</strong> removed
            </>
          }
        />
      )}
      {diff.duplicateGroupsAdded > 0 && (
        <Chip
          icon={<CodeIcon size={11} />}
          accent={TOK.amber}
          label={
            <>
              <strong>{diff.duplicateGroupsAdded}</strong> new dup-group
              {diff.duplicateGroupsAdded === 1 ? "" : "s"}
            </>
          }
        />
      )}
      {diff.duplicateGroupsDissolved > 0 && (
        <Chip
          icon={<ShieldCheck size={11} />}
          accent={TOK.accent}
          label={
            <>
              <strong>{diff.duplicateGroupsDissolved}</strong> dup-group
              {diff.duplicateGroupsDissolved === 1 ? "" : "s"} resolved
            </>
          }
        />
      )}
      {diff.coverageDelta && diff.coverageDelta.delta !== 0 && (
        <Chip
          icon={
            diff.coverageDelta.delta > 0 ? (
              <ArrowUp size={11} />
            ) : (
              <ArrowDown size={11} />
            )
          }
          accent={diff.coverageDelta.delta > 0 ? TOK.accent : TOK.rose}
          label={
            <>
              Coverage <strong>{diff.coverageDelta.fromPct}%</strong> →{" "}
              <strong>{diff.coverageDelta.toPct}%</strong>
            </>
          }
        />
      )}
    </div>
  );
}

function Chip({
  icon,
  label,
  accent,
}: {
  icon: React.ReactNode;
  label: React.ReactNode;
  accent: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md"
      style={{
        background: `${accent}1a`,
        color: accent,
        border: `1px solid ${accent}33`,
      }}
    >
      {icon}
      <span style={{ color: TOK.textPrimary }}>{label}</span>
    </span>
  );
}

function FunctionList({
  title,
  total,
  items,
  accent,
  Icon,
}: {
  title: string;
  total: number;
  items: StructuralFnRef[];
  accent: string;
  Icon: React.ComponentType<{ size?: number }>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Icon size={12} />
        <span
          className="text-[11px] uppercase tracking-[0.08em] font-semibold"
          style={{ color: accent }}
        >
          {title}
        </span>
        {total > items.length && (
          <span className="text-[11px]" style={{ color: TOK.textMuted }}>
            top {items.length} of {total}
          </span>
        )}
      </div>
      <ul className="flex flex-col gap-1.5">
        {items.map((f, i) => (
          <li
            key={`${f.filePath}:${f.containerType ?? ""}:${f.name}:${i}`}
            className="flex items-baseline gap-2 text-[12px]"
          >
            <span
              className="font-mono truncate"
              style={{ color: TOK.textPrimary }}
              title={
                f.containerType ? `${f.containerType}.${f.name}` : f.name
              }
            >
              {f.containerType ? `${f.containerType}.${f.name}` : f.name}
            </span>
            <span
              className="font-mono text-[10px] tabular-nums"
              style={{ color: TOK.textMuted }}
              title={`McCabe complexity ${f.complexity}`}
            >
              c{f.complexity}
            </span>
            <span
              className="font-mono text-[10px] truncate ml-auto"
              style={{ color: TOK.textMuted }}
              title={f.filePath}
            >
              {f.filePath}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ComplexityList({
  title,
  items,
  accent,
  Icon,
}: {
  title: string;
  items: ComplexityShift[];
  accent: string;
  Icon: React.ComponentType<{ size?: number }>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Icon size={12} />
        <span
          className="text-[11px] uppercase tracking-[0.08em] font-semibold"
          style={{ color: accent }}
        >
          {title}
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {items.map((s, i) => (
          <li
            key={`${s.filePath}:${i}`}
            className="flex items-baseline gap-2 text-[12px]"
          >
            <span
              className="font-mono truncate"
              style={{ color: TOK.textPrimary }}
              title={s.filePath}
            >
              {s.filePath}
            </span>
            <span
              className="font-mono text-[10px] tabular-nums ml-auto"
              style={{ color: TOK.textMuted }}
              title={`Complexity ${s.fromComplexity} → ${s.toComplexity}`}
            >
              {s.fromComplexity} → {s.toComplexity}
            </span>
            <span
              className="font-mono text-[11px] tabular-nums font-semibold"
              style={{ color: accent }}
            >
              {s.delta > 0 ? `+${s.delta}` : s.delta}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

