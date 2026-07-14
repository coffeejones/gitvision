"use client";

// Refactor-Safety Radar — the "Can I touch this?" surface (Arc 1).
//
// The whole product circles "what is my codebase like?"; this view answers the
// action question — "where can I act, and how safely?" It ranks files into
// four named safety TIERS and, crucially, never shows a bare score: every row
// carries the receipts (dependents, untested dependents, complexity, dupes) so
// the tier is an argument you can audit, not a magic number.

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Copy,
  FlaskConical,
  Lock,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import { TOK } from "@/lib/sessionTheme";
import {
  SAFETY_TIERS,
  type FileSafety,
  type RefactorSafetyReport,
  type SafetyTier,
} from "@/lib/refactorSafety";

const MONO = { fontFamily: "var(--font-mono)" } as const;

const TIER_META: Record<
  SafetyTier,
  { label: string; blurb: string; color: string; soft: string }
> = {
  "load-bearing": {
    label: "Load-bearing",
    blurb: "Changing this ripples widely and the safety net is thin.",
    color: TOK.rose,
    soft: TOK.roseSoft,
  },
  "handle-with-care": {
    label: "Handle with care",
    blurb: "A surprising ripple, or hard to change correctly.",
    color: TOK.amber,
    soft: TOK.amberSoft,
  },
  moderate: {
    label: "Moderate",
    blurb: "Something depends on it, but the blast is contained.",
    color: TOK.textSecondary,
    soft: TOK.surface,
  },
  safe: {
    label: "Safe to change",
    blurb: "Near-isolated — change it in relative confidence.",
    color: TOK.textMuted,
    soft: TOK.surface,
  },
};

function baseName(p: string): string {
  return p.split("/").pop() || p;
}

/** One evidence chip: label + value, coloured only when it's a risk. */
function Chip({
  children,
  color,
  soft,
  title,
}: {
  children: React.ReactNode;
  color?: string;
  soft?: string;
  title?: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded tabular-nums shrink-0"
      style={{
        background: soft ?? TOK.surfaceElevated,
        color: color ?? TOK.textMuted,
      }}
      title={title}
    >
      {children}
    </span>
  );
}

function EvidenceChips({ f }: { f: FileSafety }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap shrink-0">
      <Chip title="Distinct files that import or call into this one">
        {f.dependents} depend
      </Chip>
      {f.untestedDependents > 0 && (
        <Chip
          color={TOK.rose}
          soft={TOK.roseSoft}
          title="Of the dependents, how many have no test reaching them — a regression here can break them silently"
        >
          {f.untestedDependents} untested
        </Chip>
      )}
      <Chip title="Aggregate cyclomatic complexity (sum of decision points)">
        cx {f.complexity}
      </Chip>
      {f.duplicatedFns > 0 && (
        <Chip
          color={TOK.amber}
          soft={TOK.amberSoft}
          title="Functions here whose body is structurally duplicated elsewhere — change one copy and the others drift"
        >
          <Copy size={9} /> {f.duplicatedFns}
        </Chip>
      )}
    </div>
  );
}

function FileRow({
  f,
  open,
  onToggle,
  sessionId,
  entitled,
}: {
  f: FileSafety;
  open: boolean;
  onToggle: () => void;
  sessionId: string;
  entitled: boolean;
}) {
  const meta = TIER_META[f.tier];
  const highTier = f.tier === "load-bearing" || f.tier === "handle-with-care";
  return (
    <div style={{ borderBottom: `1px solid ${TOK.border}` }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-2.5 py-2 px-2 text-left hover:bg-white/5 transition"
      >
        <span
          className="h-2 w-2 rounded-full shrink-0"
          style={{ background: meta.color }}
        />
        <span className="flex-1 min-w-0 flex items-baseline gap-2">
          <span
            className="text-[13px] truncate"
            style={{ ...MONO, color: TOK.textPrimary }}
            title={f.file}
          >
            {baseName(f.file)}
          </span>
          <span
            className="text-[10px] truncate hidden sm:inline"
            style={{ ...MONO, color: TOK.textMuted }}
          >
            {f.file.includes("/")
              ? f.file.slice(0, f.file.lastIndexOf("/"))
              : ""}
          </span>
        </span>
        <EvidenceChips f={f} />
        {open ? (
          <ChevronDown size={13} style={{ color: TOK.textMuted }} />
        ) : (
          <ChevronRight size={13} style={{ color: TOK.textMuted }} />
        )}
      </button>

      {open && (
        <div className="px-4 pb-3 pt-1 flex flex-col gap-2.5">
          <p className="text-[13px]" style={{ color: TOK.textSecondary }}>
            <span style={{ ...MONO, color: TOK.textPrimary }}>{f.file}</span> —{" "}
            {f.dependents === 0
              ? "nothing in the graph depends on this."
              : `${f.dependents} file${f.dependents === 1 ? "" : "s"} depend on it`}
            {f.untestedDependents > 0 && (
              <>
                ,{" "}
                <span style={{ color: TOK.rose }}>
                  {f.untestedDependents} with no test guarding a regression
                </span>
              </>
            )}
            . Complexity {f.complexity}
            {f.duplicatedFns > 0 && (
              <>
                {" · "}
                {f.duplicatedFns} duplicated function
                {f.duplicatedFns === 1 ? "" : "s"}
              </>
            )}
            {!f.tested && f.dependents > 0 && (
              <> · this file itself has no test reaching it</>
            )}
            .
          </p>

          {f.untestedDependentSample.length > 0 && (
            <div className="flex flex-col gap-1">
              <span
                className="text-[10px] uppercase tracking-[0.1em] inline-flex items-center gap-1"
                style={{ color: TOK.rose }}
              >
                <TriangleAlert size={10} /> Breaks silently — no test
              </span>
              <div className="flex flex-col">
                {f.untestedDependentSample.map((d) => (
                  <span
                    key={d}
                    className="text-[12px] truncate"
                    style={{ ...MONO, color: TOK.textSecondary }}
                    title={d}
                  >
                    {d}
                  </span>
                ))}
                {f.untestedDependents > f.untestedDependentSample.length && (
                  <span className="text-[11px]" style={{ color: TOK.textMuted }}>
                    + {f.untestedDependents - f.untestedDependentSample.length}{" "}
                    more
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Test Prioritizer (Plus) — which tests to run before touching it */}
          {highTier && (
            <div className="flex flex-col gap-1">
              <span
                className="text-[10px] uppercase tracking-[0.1em] inline-flex items-center gap-1"
                style={{ color: TOK.textMuted }}
              >
                <FlaskConical size={10} /> Run these tests first
              </span>
              {!entitled ? (
                <Link
                  href={`/login?next=${encodeURIComponent(`/session/${sessionId}/refactor`)}`}
                  className="inline-flex items-center gap-1.5 text-[12px] self-start rounded px-2 py-1 transition hover:opacity-80"
                  style={{ background: TOK.surfaceElevated, color: TOK.textSecondary }}
                >
                  <Lock size={11} /> See which tests guard this change —{" "}
                  <span style={{ color: TOK.accent }}>free, sign in</span>
                </Link>
              ) : f.testsToRun && f.testsToRun.length > 0 ? (
                <div className="flex flex-col gap-0.5">
                  {f.testsToRun.map((t) => (
                    <div key={t.file} className="flex items-center gap-2">
                      <span
                        className="text-[12px] truncate flex-1 min-w-0"
                        style={{ ...MONO, color: TOK.textSecondary }}
                        title={t.file}
                      >
                        {t.file}
                      </span>
                      <span
                        className="text-[10px] tabular-nums shrink-0"
                        style={{ color: TOK.textMuted }}
                        title="How many of the affected files this test reaches"
                      >
                        guards {t.guards}
                      </span>
                    </div>
                  ))}
                  <span className="text-[10px]" style={{ color: TOK.textMuted }}>
                    Static import/call mapping — not a coverage measurement.
                  </span>
                </div>
              ) : (
                <span className="text-[12px]" style={{ color: TOK.textMuted }}>
                  No test file reaches the affected code — there's nothing to run
                  first.
                </span>
              )}
            </div>
          )}

          <Link
            href={`/session/${sessionId}/imports`}
            className="inline-flex items-center gap-1 text-[12px] self-start transition hover:opacity-80"
            style={{ color: TOK.accent }}
          >
            See the blast in the dependency canvas <ArrowRight size={12} />
          </Link>
        </div>
      )}
    </div>
  );
}

export function RefactorRadar({
  report,
  sessionId,
  entitled,
}: {
  report: RefactorSafetyReport;
  sessionId: string;
  /** Whether the viewer's plan unlocks the Test Prioritizer (Plus). */
  entitled: boolean;
}) {
  // Load-bearing + handle-with-care open by default (the files that matter);
  // moderate + safe collapse to a count so the index leads with risk.
  const [openTiers, setOpenTiers] = useState<Record<SafetyTier, boolean>>({
    "load-bearing": true,
    "handle-with-care": true,
    moderate: false,
    safe: false,
  });
  const [openFile, setOpenFile] = useState<string | null>(null);

  const byTier = (t: SafetyTier) => report.files.filter((f) => f.tier === t);

  return (
    <section className="flex flex-col gap-4" aria-label="Refactor safety">
      {/* Tier summary */}
      <div className="flex flex-wrap items-center gap-2">
        {SAFETY_TIERS.map((t) => {
          const meta = TIER_META[t];
          const n = report.counts[t];
          return (
            <span
              key={t}
              className="inline-flex items-center gap-1.5 text-[12px] px-2 py-1 rounded-md"
              style={{ background: TOK.surface, border: `1px solid ${TOK.border}` }}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: meta.color }}
              />
              <span className="tabular-nums" style={{ color: TOK.textPrimary }}>
                {n}
              </span>
              <span style={{ color: TOK.textMuted }}>{meta.label}</span>
            </span>
          );
        })}
      </div>

      {SAFETY_TIERS.map((t) => {
        const files = byTier(t);
        if (files.length === 0) return null;
        const meta = TIER_META[t];
        const open = openTiers[t];
        return (
          <div
            key={t}
            className="rounded-xl overflow-hidden"
            style={{ background: TOK.surface, border: `1px solid ${TOK.border}` }}
          >
            <button
              type="button"
              onClick={() => setOpenTiers((p) => ({ ...p, [t]: !p[t] }))}
              aria-expanded={open}
              className="w-full flex items-center gap-2.5 px-4 py-3 text-left"
            >
              <ShieldAlert size={15} style={{ color: meta.color }} />
              <span
                className="text-[13px] font-semibold"
                style={{ color: TOK.textPrimary }}
              >
                {meta.label}
              </span>
              <span
                className="text-[11px] tabular-nums px-1.5 rounded"
                style={{ background: meta.soft, color: meta.color }}
              >
                {files.length}
              </span>
              <span
                className="text-[12px] flex-1 truncate hidden md:block"
                style={{ color: TOK.textMuted }}
              >
                {meta.blurb}
              </span>
              {open ? (
                <ChevronDown size={14} style={{ color: TOK.textMuted }} />
              ) : (
                <ChevronRight size={14} style={{ color: TOK.textMuted }} />
              )}
            </button>
            {open && (
              <div
                className="flex flex-col max-h-[60vh] overflow-y-auto"
                style={{ borderTop: `1px solid ${TOK.border}` }}
              >
                {files.map((f) => (
                  <FileRow
                    key={f.file}
                    f={f}
                    open={openFile === f.file}
                    onToggle={() =>
                      setOpenFile((cur) => (cur === f.file ? null : f.file))
                    }
                    sessionId={sessionId}
                    entitled={entitled}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
