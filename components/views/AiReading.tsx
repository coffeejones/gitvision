"use client";

// The AI reading, shared by every surface that shows one.
//
// Extracted from FunctionInsight (the Source view) when the Flows surface grew
// the same feature: both render the SAME payload from the SAME endpoint
// (POST /api/sessions/[id]/source/explain → { signals, explanation }), so two
// copies would have drifted into two different-looking products within months.
//
// The layout encodes the grounding contract, and that's the reason it looks the
// way it does:
//   - EvidenceRow is COMPUTED fact — chips, scannable, no prose.
//   - AiReadingBody is the model's READING of that fact — prose, labelled.
//   - AiReadingDivider is the seam between them. The separation is the honesty:
//     a reader can always tell which half a claim came from.
// Keep that order (evidence above, reading below) wherever this is used.

import {
  ArrowLeftToLine,
  Copy,
  FlaskConical,
  Flame,
  History,
  Info,
  Lightbulb,
  ShieldAlert,
  Waypoints,
} from "lucide-react";
import { TOK } from "@/lib/sessionTheme";
import { complexityTone } from "@/lib/sourceAnnotations";
import type { FunctionSignals } from "@/lib/functionSignals";

/** The three grounded parts the explainer returns. Mirrors FunctionExplanation
 *  without importing the server module into every client surface. */
export interface AiReadingParts {
  does: string;
  risk: string;
  suggestion?: string | null;
}

/** A quiet hairline marking the seam between the deterministic evidence above
 *  and the AI reading below — the separation does the work, no label needed. */
export function AiReadingDivider() {
  return <div className="h-px w-full" style={{ background: TOK.border }} aria-hidden />;
}

/** The computed signals as chips. Every chip is a fact the analysis measured —
 *  nothing here is generated. */
export function EvidenceRow({ signals }: { signals: FunctionSignals }) {
  const chips: React.ReactNode[] = [];
  const tone = complexityTone(signals.complexity);
  chips.push(
    <EvChip
      key="cx"
      icon={<Waypoints size={11} />}
      label={`Complexity ${signals.complexity}`}
      color={tone === "high" ? TOK.rose : tone === "medium" ? TOK.amber : TOK.textMuted}
    />,
  );
  if (signals.changed) {
    chips.push(
      <EvChip
        key="chg"
        icon={<History size={11} />}
        label={signals.changed === "new" ? "New" : "Modified"}
        color={TOK.accent}
      />,
    );
  }
  if (signals.callerCount > 0) {
    chips.push(
      <EvChip
        key="cal"
        icon={<Waypoints size={11} />}
        label={`Called from ${signals.callerCount}`}
        color={TOK.textMuted}
      />,
    );
  }
  if (signals.duplicateCount > 0) {
    chips.push(
      <EvChip
        key="dup"
        icon={<Copy size={11} />}
        label={`${signals.duplicateCount} twin${signals.duplicateCount === 1 ? "" : "s"}`}
        color={TOK.amber}
      />,
    );
  }
  if (signals.fileTested === false) {
    chips.push(
      <EvChip key="test" icon={<FlaskConical size={11} />} label="No test guards it" color={TOK.amber} />,
    );
  }
  if (signals.fileFanIn > 0) {
    chips.push(
      <EvChip
        key="fin"
        icon={<ArrowLeftToLine size={11} />}
        label={`${signals.fileFanIn} dependent${signals.fileFanIn === 1 ? "" : "s"}`}
        color={TOK.textMuted}
      />,
    );
  }
  if (signals.soloAuthor) {
    chips.push(<EvChip key="bus" icon={<Flame size={11} />} label="Bus factor 1" color={TOK.rose} />);
  }
  return <div className="flex items-center gap-1.5 flex-wrap">{chips}</div>;
}

/** The model's reading, in three labelled parts. The labels exist because the
 *  register shifts between them — description, then concern, then action — and
 *  an unlabelled wall of three paragraphs makes the reader discover that shift
 *  on their own. `suggestion` is nullable and simply omitted when absent. */
export function AiReadingBody({ explanation }: { explanation: AiReadingParts }) {
  return (
    <div className="flex flex-col gap-3">
      <Part
        icon={<Info size={13} />}
        label="What it does"
        text={explanation.does}
        color={TOK.textSecondary}
      />
      <Part
        icon={<ShieldAlert size={13} />}
        label="Where the risk is"
        text={explanation.risk}
        color={TOK.textPrimary}
      />
      {explanation.suggestion && (
        <Part
          icon={<Lightbulb size={13} />}
          label="Worth considering"
          text={explanation.suggestion}
          color={TOK.textSecondary}
          accent
        />
      )}
    </div>
  );
}

// ---------------- internals ----------------

function EvChip({ icon, label, color }: { icon: React.ReactNode; label: string; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10.5px] font-medium px-1.5 py-0.5 rounded"
      style={{ color, background: "rgba(255,255,255,0.03)", border: `1px solid ${TOK.border}` }}
    >
      <span className="flex-shrink-0" style={{ color }}>
        {icon}
      </span>
      {label}
    </span>
  );
}

function Part({
  icon,
  label,
  text,
  color,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  text: string;
  color: string;
  accent?: boolean;
}) {
  return (
    <div
      className="flex flex-col gap-1"
      style={accent ? { borderLeft: `2px solid ${TOK.accent}`, paddingLeft: 10 } : undefined}
    >
      <div
        className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em]"
        style={{ color: TOK.textMuted }}
      >
        <span className="flex-shrink-0">{icon}</span>
        {label}
      </div>
      <p className="text-[12.5px] leading-relaxed" style={{ color }}>
        {text}
      </p>
    </div>
  );
}
