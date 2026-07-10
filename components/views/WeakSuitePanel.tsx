"use client";

// Weak-Suite panel — "coverage that means nothing" (Arc 1).
//
// The deceptive metric in AI-heavy repos: a green coverage number over tests
// that execute code but assert nothing that would catch a regression. This view
// ranks test files by how HOLLOW their assertions are and shows the receipts on
// every row — the tier is an argument you can audit, never a magic score. The
// whole surface is Plus; free users see the aggregate hook + an upsell.

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Lock, FlaskConical, Dot } from "lucide-react";
import { TOK } from "@/lib/sessionTheme";
import {
  WEAK_SUITE_TIERS,
  type WeakSuiteTier,
  type WeakSuiteSummary,
  type WeakTestFile,
} from "@/lib/weakSuite";

const MONO = { fontFamily: "var(--font-mono)" } as const;

const TIER_META: Record<
  WeakSuiteTier,
  { label: string; blurb: string; color: string; soft: string }
> = {
  hollow: {
    label: "Hollow",
    blurb: "Runs code but verifies almost nothing — coverage that means nothing.",
    color: TOK.rose,
    soft: TOK.roseSoft,
  },
  thin: {
    label: "Thin",
    blurb: "Some cases assert nothing, or the suite is thinly checked overall.",
    color: TOK.amber,
    soft: TOK.amberSoft,
  },
  solid: {
    label: "Solid",
    blurb: "Value-checking assertions throughout.",
    color: TOK.accent,
    soft: TOK.accentSoft,
  },
};

function baseName(p: string): string {
  return p.split("/").pop() || p;
}
function dirName(p: string): string {
  return p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
}
function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export function WeakSuitePanel({
  summary,
  files,
  entitled,
}: {
  summary: WeakSuiteSummary;
  files?: WeakTestFile[];
  entitled: boolean;
}) {
  const { counts, totals } = summary;

  return (
    <div className="flex flex-col gap-6">
      {/* Aggregate hook — the one screenshot-worthy number. */}
      <div
        className="rounded-xl p-5 flex flex-col gap-4"
        style={{ background: TOK.surface, border: `1px solid ${TOK.border}` }}
      >
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div className="flex flex-col">
            <span
              className="text-3xl font-semibold tabular-nums"
              style={{
                ...MONO,
                color: totals.smokeOnlyRatio >= 0.2 ? TOK.rose : TOK.textPrimary,
                letterSpacing: "-0.02em",
              }}
            >
              {pct(totals.smokeOnlyRatio)}
            </span>
            <span className="text-[12px]" style={{ color: TOK.textMuted }}>
              of test cases assert nothing meaningful
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-3xl font-semibold tabular-nums" style={{ ...MONO, color: TOK.textPrimary }}>
              {totals.assertionDensity}
            </span>
            <span className="text-[12px]" style={{ color: TOK.textMuted }}>
              assertions per test case
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-3xl font-semibold tabular-nums" style={{ ...MONO, color: TOK.textPrimary }}>
              {totals.testCases}
            </span>
            <span className="text-[12px]" style={{ color: TOK.textMuted }}>
              test cases across {totals.testFiles} files
            </span>
          </div>
        </div>

        {/* Tier tally */}
        <div className="flex flex-wrap gap-2">
          {WEAK_SUITE_TIERS.map((tier) => {
            const meta = TIER_META[tier];
            const n = counts[tier];
            return (
              <span
                key={tier}
                className="inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-full"
                style={{ background: meta.soft, color: n > 0 ? meta.color : TOK.textMuted }}
                title={meta.blurb}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: meta.color }} />
                {n} {meta.label.toLowerCase()}
              </span>
            );
          })}
        </div>
      </div>

      {/* Per-file breakdown (Plus). */}
      {!entitled ? (
        <Link
          href="/pricing"
          className="rounded-xl p-6 flex flex-col items-start gap-2 transition hover:opacity-90"
          style={{ background: TOK.surface, border: `1px dashed ${TOK.border}` }}
        >
          <span
            className="inline-flex items-center gap-1.5 text-[13px] font-medium"
            style={{ color: TOK.textPrimary }}
          >
            <Lock size={13} /> See which test files are hollow
          </span>
          <span className="text-[13px]" style={{ color: TOK.textSecondary }}>
            The per-file, per-test-case breakdown — which specific tests assert nothing, and
            the exact matchers we count as smoke — is a{" "}
            <span style={{ color: TOK.accent }}>Plus</span> feature.
          </span>
        </Link>
      ) : files && files.length > 0 ? (
        <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${TOK.border}` }}>
          {files.map((f) => (
            <FileRow key={f.file} f={f} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FileRow({ f }: { f: WeakTestFile }) {
  const [open, setOpen] = useState(false);
  const meta = TIER_META[f.tier];
  const smoke = f.cases?.filter((c) => c.assertions === 0 || !c.hasMeaningfulOracle) ?? [];

  return (
    <div style={{ borderBottom: `1px solid ${TOK.border}` }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2.5 py-2.5 px-3 text-left hover:bg-white/5 transition"
      >
        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: meta.color }} />
        <span className="flex-1 min-w-0 flex items-baseline gap-2">
          <span className="text-[13px] truncate" style={{ ...MONO, color: TOK.textPrimary }} title={f.file}>
            {baseName(f.file)}
          </span>
          <span className="text-[10px] truncate hidden sm:inline" style={{ ...MONO, color: TOK.textMuted }}>
            {dirName(f.file)}
          </span>
        </span>
        <div className="flex items-center gap-1.5 flex-wrap shrink-0">
          <Chip title="Test cases (it/test blocks) in this file">{f.testCases} cases</Chip>
          <Chip title="Assertions per test case">{f.assertionDensity}/case</Chip>
          {f.smokeOnlyCases > 0 && (
            <Chip color={TOK.rose} soft={TOK.roseSoft} title="Cases that assert nothing meaningful">
              {f.smokeOnlyCases} smoke-only
            </Chip>
          )}
        </div>
        {open ? (
          <ChevronDown size={13} style={{ color: TOK.textMuted }} />
        ) : (
          <ChevronRight size={13} style={{ color: TOK.textMuted }} />
        )}
      </button>

      {open && (
        <div className="px-4 pb-3 pt-1 flex flex-col gap-2.5">
          <p className="text-[13px]" style={{ color: TOK.textSecondary }}>
            <span style={{ ...MONO, color: TOK.textPrimary }}>{f.file}</span> — {f.assertions} assertion
            {f.assertions === 1 ? "" : "s"} across {f.testCases} case{f.testCases === 1 ? "" : "s"}
            {f.smokeOnlyCases > 0 ? (
              <>
                {", "}
                <span style={{ color: TOK.rose }}>
                  {f.smokeOnlyCases} verifying nothing meaningful ({pct(f.smokeOnlyRatio)})
                </span>
              </>
            ) : (
              <>, all with a value-checking oracle</>
            )}
            .
          </p>

          {f.trivialOracleNames.length > 0 && (
            <p className="text-[12px]" style={{ color: TOK.textMuted }}>
              Trivial oracles counted:{" "}
              <span style={{ ...MONO, color: TOK.textSecondary }}>
                {f.trivialOracleNames.join(", ")}
              </span>
            </p>
          )}

          {smoke.length > 0 && (
            <div className="flex flex-col gap-1">
              <span
                className="text-[10px] uppercase tracking-[0.1em] inline-flex items-center gap-1"
                style={{ color: TOK.rose }}
              >
                <FlaskConical size={10} /> Executes but verifies nothing
              </span>
              <div className="flex flex-col">
                {smoke.slice(0, 12).map((c, i) => (
                  <span
                    key={`${c.name}-${c.line}-${i}`}
                    className="text-[12px] truncate inline-flex items-center"
                    style={{ color: TOK.textSecondary }}
                    title={`line ${c.line}`}
                  >
                    <Dot size={14} style={{ color: TOK.textMuted }} />
                    {c.name || "(anonymous test)"}
                    <span style={{ ...MONO, color: TOK.textMuted }} className="ml-1.5 text-[11px]">
                      {c.assertions === 0 ? "no assertions" : `${c.assertions} trivial`}
                    </span>
                  </span>
                ))}
                {smoke.length > 12 && (
                  <span className="text-[11px] pl-4" style={{ color: TOK.textMuted }}>
                    + {smoke.length - 12} more
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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
      style={{ background: soft ?? TOK.surfaceElevated, color: color ?? TOK.textMuted }}
      title={title}
    >
      {children}
    </span>
  );
}
