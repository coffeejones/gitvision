// StatusGrid — 3-card overview row for /session/[id]/security (v0.81+).
//
// Each scanner gets ONE compact card with: title, scanner-scope hint
// (subtitle), and a status pill colored by outcome (emerald clean /
// rose findings / muted "not scanned"). The whole grid sits above the
// unified findings list so visitors can answer "what's my overall
// security posture?" in 2 seconds without scrolling.
//
// Three states per card mirror the data layer:
//   "clean"        — scanner ran, zero findings. Show "✓ Clean" pill.
//   "findings"     — scanner ran, findings present. Show count pill.
//   "not scanned"  — pre-v0.81 snapshot or scan failed. Muted pill.

import { TOK } from "@/lib/sessionTheme";

interface StatusCardProps {
  title: string;
  subtitle: string;
  state: "clean" | "findings" | "not-scanned";
  countLabel?: string;
}

interface Props {
  incidents: StatusCardProps;
  secrets: StatusCardProps;
  patterns: StatusCardProps;
}

export function StatusGrid({ incidents, secrets, patterns }: Props) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <StatusCard {...incidents} />
      <StatusCard {...secrets} />
      <StatusCard {...patterns} />
    </div>
  );
}

function StatusCard({ title, subtitle, state, countLabel }: StatusCardProps) {
  const palette = paletteFor(state);
  const pillText =
    state === "clean"
      ? "Clean"
      : state === "findings"
        ? (countLabel ?? "Findings")
        : "Not scanned";

  return (
    <div
      className="flex flex-col gap-2 p-4 rounded-lg"
      style={{
        background: TOK.surface,
        border: `1px solid ${TOK.border}`,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <h3
          className="text-sm font-semibold tracking-tight"
          style={{ color: TOK.textPrimary, letterSpacing: "-0.01em" }}
        >
          {title}
        </h3>
        <span
          className="text-[9px] uppercase tracking-[0.14em] font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
          style={{
            background: palette.bg,
            color: palette.text,
            border: `1px solid ${palette.border}`,
          }}
        >
          {state === "clean" ? "✓" : ""} {pillText}
        </span>
      </div>
      <p
        className="text-xs leading-relaxed"
        style={{ color: TOK.textMuted }}
      >
        {subtitle}
      </p>
    </div>
  );
}

function paletteFor(state: "clean" | "findings" | "not-scanned") {
  if (state === "clean") {
    return {
      bg: `${TOK.accent}1a`,
      text: TOK.accent,
      border: `${TOK.accent}40`,
    };
  }
  if (state === "findings") {
    return { bg: `${TOK.rose}1a`, text: TOK.rose, border: `${TOK.rose}40` };
  }
  return {
    bg: "rgba(255,255,255,0.04)",
    text: TOK.textMuted,
    border: TOK.border,
  };
}
