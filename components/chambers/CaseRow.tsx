"use client";

// CaseRow — one case as a dossier file. A mono case-number header with
// a barcode motif, a folded corner (dog-ear), the verdict score ring,
// the repo + headline finding, and metrics. A tone stripe runs down the
// filed edge; the verdict severity reads from the ring + edge tone (no
// ruling stamps). Whole card links into the session. Dark — see theme.

import Link from "next/link";
import {
  Lock,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Check,
  X,
} from "lucide-react";
import { CH, CH_FOCUS } from "./theme";

export type Ruling = "Cleared" | "Conditional" | "Returned";

export interface CaseItem {
  id: string;
  /** Case file number, e.g. "2026-0481". */
  caseNo: string;
  /** Display name (falls back to repoFullName). */
  name: string;
  repoFullName: string;
  isPrivate: boolean;
  /** Verdict. */
  grade: string; // "A−", "B", "D+"…
  score: number; // 0–100
  ruling: Ruling;
  /** Detail. */
  criticalCount: number;
  snapshotCount: number;
  updatedAt: string;
  /** Top finding, one line. */
  headline: string;
  /** Per-department status for the breakdown strip (which axis failed). */
  departments: {
    key: "Health" | "Security" | "Forensics" | "Supply";
    status: "ok" | "warning" | "critical";
  }[];
}

const TONE: Record<Ruling, string> = {
  Cleared: CH.ok,
  Conditional: CH.warning,
  Returned: CH.critical,
};
const TONE_SOFT: Record<Ruling, string> = {
  Cleared: "rgba(74,222,128,0.14)",
  Conditional: CH.warningSoft,
  Returned: CH.criticalSoft,
};
const RULING_ICON: Record<Ruling, typeof Lock> = {
  Cleared: CheckCircle2,
  Conditional: AlertTriangle,
  Returned: XCircle,
};

type DeptStatus = "ok" | "warning" | "critical";
const DEPT_ABBR: Record<string, string> = {
  Health: "H",
  Security: "S",
  Forensics: "F",
  Supply: "Su",
};
// Each status carries a SHAPE (lucide glyph) as well as a colour, so the
// strip survives colour-blindness + a greyscale screenshot (WCAG 1.4.1),
// and a passing department reads as "confirmed" (calm green) rather than
// greyed-out/disabled.
const DEPT_STATUS_STYLE: Record<
  DeptStatus,
  { fg: string; bg: string; Icon: typeof Check; word: string }
> = {
  ok: { fg: CH.ok, bg: "rgba(74,222,128,0.10)", Icon: Check, word: "pass" },
  warning: { fg: CH.warning, bg: CH.warningSoft, Icon: AlertTriangle, word: "conditional" },
  critical: { fg: CH.critical, bg: CH.criticalSoft, Icon: X, word: "fail" },
};

export function CaseRow({ c }: { c: CaseItem }) {
  const tone = TONE[c.ruling];

  return (
    <Link
      href={`/session/${c.id}`}
      className="group relative block overflow-hidden rounded-xl transition-colors"
      style={{ background: CH.panel, border: `1px solid ${CH.border}` }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = CH.panelHover;
        e.currentTarget.style.borderColor = CH.borderStrong;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = CH.panel;
        e.currentTarget.style.borderColor = CH.border;
      }}
    >
      {/* filed-edge tone stripe */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: tone }}
      />
      {/* folded corner (dog-ear) */}
      <span
        aria-hidden
        className="absolute right-0 top-0"
        style={{
          width: 0,
          height: 0,
          borderTop: `20px solid ${CH.elevated}`,
          borderLeft: "20px solid transparent",
          filter: "drop-shadow(-1px 1px 1px rgba(0,0,0,0.45))",
        }}
      />

      {/* header — case number + barcode motif */}
      <div
        className="flex items-center justify-between gap-3 pl-5 pr-9 py-2"
        style={{ borderBottom: `1px solid ${CH.border}` }}
      >
        <span
          className="font-mono text-[10.5px] uppercase tracking-[0.16em]"
          style={{ color: CH.textMuted }}
        >
          Case No. {c.caseNo}
        </span>
      </div>

      {/* body */}
      <div className="flex items-center gap-4 pl-5 pr-4 py-4">
        <ScoreRing grade={c.grade} score={c.score} tone={tone} />

        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center gap-2">
            <span
              className="truncate text-[15px] font-semibold"
              style={{ color: CH.text }}
            >
              {c.name}
            </span>
            {c.isPrivate && (
              <Lock size={11} style={{ color: CH.textMuted }} aria-label="private" />
            )}
            <RulingBadge ruling={c.ruling} tone={tone} />
          </span>
          <span className="truncate text-[12.5px]" style={{ color: CH.textDim }}>
            {c.headline}
          </span>
          <DeptStrip departments={c.departments} />
        </span>

        <span className="hidden sm:flex flex-none flex-col items-end gap-1.5">
          <span className="flex items-center gap-2.5">
            {c.criticalCount > 0 && (
              <span
                className="rounded-md px-2 py-0.5 text-[11px] font-semibold"
                style={{ color: CH.critical, background: CH.criticalSoft }}
              >
                {c.criticalCount} critical
              </span>
            )}
            <span
              className="font-mono text-[11px] tabular-nums"
              style={{ color: CH.textMuted }}
            >
              {c.snapshotCount} {c.snapshotCount === 1 ? "snapshot" : "snapshots"}
            </span>
          </span>
          <span className="text-[11px]" style={{ color: CH.textMuted }}>
            filed {ago(c.updatedAt)}
          </span>
        </span>

        <ChevronRight
          size={16}
          className="flex-none transition-transform group-hover:translate-x-0.5"
          style={{ color: CH.textMuted }}
        />
      </div>
    </Link>
  );
}

function RulingBadge({ ruling, tone }: { ruling: Ruling; tone: string }) {
  const Icon = RULING_ICON[ruling];
  return (
    <span
      className="inline-flex flex-none items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold"
      style={{ color: tone, background: TONE_SOFT[ruling] }}
    >
      <Icon size={11} aria-hidden />
      {ruling}
    </span>
  );
}

function DeptStrip({
  departments,
}: {
  departments: CaseItem["departments"];
}) {
  return (
    <span className="mt-0.5 flex items-center gap-1.5" aria-label="Department breakdown">
      {departments.map((d) => {
        const s = DEPT_STATUS_STYLE[d.status];
        const Icon = s.Icon;
        return (
          <span
            key={d.key}
            title={`${d.key}: ${s.word}`}
            aria-label={`${d.key}: ${s.word}`}
            className="inline-flex h-[18px] items-center gap-1 rounded px-1.5 text-[10px] font-bold leading-none"
            style={{ color: s.fg, background: s.bg }}
          >
            <Icon size={9} strokeWidth={3} aria-hidden />
            {DEPT_ABBR[d.key]}
          </span>
        );
      })}
    </span>
  );
}

function ScoreRing({
  grade,
  score,
  tone,
}: {
  grade: string;
  score: number;
  tone: string;
}) {
  const R = 23;
  const C = 2 * Math.PI * R;
  const off = C - (C * Math.max(0, Math.min(100, score))) / 100;
  return (
    <span
      className="relative flex-none"
      style={{ width: 56, height: 56 }}
      role="img"
      aria-label={`Verdict grade ${grade}, score ${score} of 100`}
    >
      <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden>
        <circle cx="28" cy="28" r={R} fill="none" stroke={CH.elevated} strokeWidth="4" />
        <circle
          cx="28"
          cy="28"
          r={R}
          fill="none"
          stroke={tone}
          strokeWidth="4"
          strokeLinecap={score >= 100 ? "butt" : "round"}
          strokeDasharray={C}
          strokeDashoffset={off}
          transform="rotate(-90 28 28)"
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="text-[16px] font-bold leading-none"
          style={{ color: CH.text, letterSpacing: "-0.02em" }}
        >
          {grade}
        </span>
        <span
          className="mt-0.5 font-mono text-[11px] leading-none"
          style={{ color: CH.textDim }}
        >
          {score}
        </span>
      </span>
    </span>
  );
}

function ago(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}
