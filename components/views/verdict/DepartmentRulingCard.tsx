// DepartmentRulingCard — one section per department on the Verdict
// page (v0.82+, Phase C).
//
// Renders a department's vote, reason, and top contributing
// signals. The "explore" CTA links to the first tab in that
// department's sidebar group so the user can keep digging.
//
// Visual rhythm matches the rest of the workspace: bordered card,
// uppercase eyebrow header with department icon, vote chip
// color-keyed to the vote (Cleared = accent, Conditional = amber,
// Failed = rose). Same color logic as VerdictHero so the page reads
// as one consistent palette.

import Link from "next/link";
import {
  ArrowRight,
  Fingerprint,
  Microscope,
  Stethoscope,
  Truck,
} from "lucide-react";
import type { DepartmentRuling } from "@/lib/intelligence/verdict";
import type { HealthSignal } from "@/lib/types";
import { TOK, STYLE } from "@/lib/theme";

interface Props {
  ruling: DepartmentRuling;
  /** Base session path (e.g. "/session/abc123") so we can append the
   *  department's explore slug. Passed in from the page rather than
   *  recomputed here. */
  sessionBase: string;
}

const DEPT_ICONS: Record<DepartmentRuling["id"], React.ReactNode> = {
  health: <Stethoscope size={13} />,
  security: <Fingerprint size={13} />,
  forensics: <Microscope size={13} />,
  supply: <Truck size={13} />,
};

interface VoteStyle {
  fg: string;
  bg: string;
}

const VOTE_STYLES: Record<DepartmentRuling["vote"], VoteStyle> = {
  pass: { fg: TOK.accent, bg: TOK.accentSoft },
  conditional: { fg: TOK.amber, bg: TOK.amberSoft },
  fail: { fg: TOK.rose, bg: TOK.roseSoft },
};

export function DepartmentRulingCard({ ruling, sessionBase }: Props) {
  const voteStyle = VOTE_STYLES[ruling.vote];

  return (
    <section
      className="flex flex-col gap-5 rounded-xl p-6"
      style={{
        background: TOK.surface,
        border: `1px solid ${TOK.border}`,
      }}
    >
      {/* Header row: dept icon + name (eyebrow) + vote chip on the
          far right. Matches the dimension-tile rhythm on the
          Overview's Health-at-a-Glance strip. */}
      <div className="flex items-center justify-between gap-3">
        <div
          className={`flex items-center gap-1.5 ${STYLE.eyebrow}`}
          style={{ color: TOK.textMuted }}
        >
          <span style={{ color: TOK.textMuted }}>
            {DEPT_ICONS[ruling.id]}
          </span>
          <span>{ruling.title}</span>
        </div>
        <span
          className="text-[10px] uppercase tracking-[0.12em] font-semibold px-2 py-0.5 rounded-full"
          style={{
            color: voteStyle.fg,
            background: voteStyle.bg,
            border: `1px solid ${voteStyle.fg}`,
          }}
        >
          {ruling.voteLabel}
        </span>
      </div>

      {/* The department's one-line argument — what drove its vote. */}
      <p
        className="text-base sm:text-lg leading-relaxed"
        style={{
          color: TOK.textPrimary,
          letterSpacing: "-0.005em",
        }}
      >
        {ruling.reason}
      </p>

      {/* Evidence list — the 1-3 signals behind the vote. Empty when
          the department has nothing to report (a clean pass with no
          working signals fired). */}
      {ruling.topSignals.length > 0 && (
        <ul className="flex flex-col gap-2">
          {ruling.topSignals.map((sig) => (
            <EvidenceRow key={sig.id} signal={sig} />
          ))}
        </ul>
      )}

      {/* Footer: signal count + explore link. The count fixes the
          "is this comprehensive?" question (e.g. "Considered 7
          signals") without dragging the user away. */}
      <div
        className="flex items-center justify-between pt-1 mt-1"
        style={{ borderTop: `1px solid ${TOK.border}` }}
      >
        <span className="text-xs" style={{ color: TOK.textMuted }}>
          {ruling.signalCount}{" "}
          {ruling.signalCount === 1 ? "signal" : "signals"} considered
        </span>
        <Link
          href={`${sessionBase}${ruling.exploreSlug}`}
          className="text-xs font-medium inline-flex items-center gap-1 transition hover:underline"
          style={{ color: TOK.accent }}
        >
          Explore {ruling.title.split(" ")[0]}
          <ArrowRight size={11} />
        </Link>
      </div>
    </section>
  );
}

/** Single-line evidence row: severity dot, title, optional detail.
 *  Sized to fit 2-3 per card without crowding. */
function EvidenceRow({ signal }: { signal: HealthSignal }) {
  const dotColor =
    signal.severity === "high"
      ? TOK.rose
      : signal.severity === "medium"
        ? TOK.amber
        : signal.severity === "low"
          ? TOK.amber
          : TOK.accent;

  return (
    <li className="flex items-start gap-2.5 text-sm">
      <span
        className="h-1.5 w-1.5 rounded-full shrink-0 mt-2"
        style={{ background: dotColor }}
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <div style={{ color: TOK.textPrimary }}>{signal.title}</div>
        {signal.detail && (
          <div
            className="text-xs mt-0.5 leading-relaxed"
            style={{ color: TOK.textMuted }}
          >
            {signal.detail}
          </div>
        )}
      </div>
    </li>
  );
}
