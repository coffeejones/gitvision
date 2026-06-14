"use client";

// CasesView — the Cases home (inside ChambersShell). Two tabs:
//
//   Public  — analyze-new-repo input + your analyzed public repos,
//             one case per row.
//   Private — your private GitHub repos (fetched on demand), with an
//             Analyse action. Built in Phase 2; a placeholder for now.

import { useEffect, useState } from "react";
import { Check, AlertTriangle, X, RefreshCw } from "lucide-react";
import { WorkspaceInputBar } from "@/components/views/WorkspaceInputBar";
import { CaseRow, type CaseItem } from "./CaseRow";
import { PrivateRepos } from "./PrivateRepos";
import { CH, CH_FOCUS } from "./theme";

interface Props {
  publicCases: CaseItem[];
  /** Analyzed private cases. The full "list every private repo from
   *  GitHub" table is a later enhancement. */
  privateCases?: CaseItem[];
}

export function CasesView({ publicCases, privateCases = [] }: Props) {
  const [tab, setTab] = useState<"public" | "private">("public");

  // Cheap "has anything changed upstream?" check (one light GitHub call
  // per case, cached ~15 min server-side). Flags cases whose repo moved
  // since our latest snapshot so CaseRow shows a "New changes" nudge.
  // Best-effort — failures just leave the badges off.
  const [changed, setChanged] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const ids = [...publicCases, ...privateCases].map((c) => c.id);
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/cases/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          changed?: Record<string, boolean>;
        };
        if (!cancelled && data.changed) setChanged(data.changed);
      } catch {
        // freshness is a cosmetic nudge — ignore failures
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicCases, privateCases]);

  const withFlags = (list: CaseItem[]): CaseItem[] =>
    list.map((c) => (changed[c.id] ? { ...c, hasNewChanges: true } : c));

  return (
    <div>
      <header className="mb-7">
        <h1
          className="text-[28px] font-semibold tracking-tight"
          style={{ color: CH.text, letterSpacing: "-0.025em" }}
        >
          Cases
        </h1>
        <p className="mt-1.5 text-[14px]" style={{ color: CH.textDim }}>
          Your repositories under review — open one for its verdict, or bring
          a new one before the bench.
        </p>
      </header>

      {/* Tabs */}
      <div
        className="mb-6 flex items-center gap-1"
        style={{ borderBottom: `1px solid ${CH.border}` }}
        role="tablist"
      >
        <Tab label="Public" active={tab === "public"} onClick={() => setTab("public")} />
        <Tab label="Private" active={tab === "private"} onClick={() => setTab("private")} />
      </div>

      {tab === "public" ? (
        <div className="flex flex-col gap-6">
          <WorkspaceInputBar />
          {publicCases.length > 0 ? (
            <div className="flex flex-col gap-3">
              <DocketSummary cases={publicCases} />
              <DeptLegend />
              <div className="flex flex-col gap-2.5">
                {withFlags(publicCases).map((c) => (
                  <CaseRow key={c.id} c={c} />
                ))}
              </div>
            </div>
          ) : (
            <EmptyState text="No public cases yet. Paste a repo above to open your first." />
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {privateCases.length > 0 && (
            <div className="flex flex-col gap-3">
              <DocketSummary cases={privateCases} />
              <DeptLegend />
              <div className="flex flex-col gap-2.5">
                {withFlags(privateCases).map((c) => (
                  <CaseRow key={c.id} c={c} />
                ))}
              </div>
            </div>
          )}
          <PrivateRepos
            analyzedRepos={new Set(privateCases.map((c) => c.repoFullName))}
          />
        </div>
      )}
    </div>
  );
}

function summarizeDeltas(cases: CaseItem[]) {
  let regressed = 0;
  let improved = 0;
  let criticalAdded = 0;
  for (const c of cases) {
    if (!c.delta) continue;
    if (c.delta.direction === "regressed") regressed++;
    else if (c.delta.direction === "improved") improved++;
    if (c.delta.criticalDelta > 0) criticalAdded += c.delta.criticalDelta;
  }
  return { regressed, improved, criticalAdded };
}

/** One-line "since your last visit" roll-up over the visible cases —
 *  hidden when nothing moved. Delivers the "exploit the update angle"
 *  principle at the docket level; the per-card DeltaLine carries the
 *  detail. */
function DocketSummary({ cases }: { cases: CaseItem[] }) {
  const { regressed, improved, criticalAdded } = summarizeDeltas(cases);
  if (!regressed && !improved && !criticalAdded) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
      <span
        className="inline-flex items-center gap-1.5 font-medium"
        style={{ color: CH.text }}
      >
        <RefreshCw size={12} style={{ color: CH.textMuted }} aria-hidden />
        Since your last visit
      </span>
      {/* Neutral tone for direction; orange reserved for the genuine critical
          count (matches the workspace rationing). */}
      {regressed > 0 && (
        <span style={{ color: CH.text }}>{regressed} regressed</span>
      )}
      {improved > 0 && (
        <span style={{ color: CH.textDim }}>{improved} improved</span>
      )}
      {criticalAdded > 0 && (
        <span style={{ color: CH.critical }}>+{criticalAdded} critical</span>
      )}
    </div>
  );
}

/** One-time key for the per-case department strip: spells out what
 *  H/S/F/Su mean and what each status glyph encodes. Answers the most
 *  common confusion from review ("four coloured letters, no legend"). */
function DeptLegend() {
  return (
    <div
      className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px]"
      style={{ color: CH.textMuted }}
    >
      <span>
        <span className="font-semibold" style={{ color: CH.textDim }}>
          Departments
        </span>{" "}
        H Health · S Security · F Forensics · Su Supply
      </span>
      <span className="flex items-center gap-3">
        <LegendKey Icon={Check} tone={CH.ok} word="pass" />
        <LegendKey Icon={AlertTriangle} tone={CH.warning} word="conditional" />
        <LegendKey Icon={X} tone={CH.critical} word="fail" />
      </span>
    </div>
  );
}

function LegendKey({
  Icon,
  tone,
  word,
}: {
  Icon: typeof Check;
  tone: string;
  word: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <Icon size={11} strokeWidth={3} style={{ color: tone }} aria-hidden />
      {word}
    </span>
  );
}

function Tab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative rounded-md px-3.5 py-2.5 text-[14px] font-medium transition-colors ${CH_FOCUS}`}
      style={{ color: active ? CH.text : CH.textMuted }}
    >
      {label}
      {active && (
        <span
          aria-hidden
          className="absolute inset-x-2 -bottom-px h-[2px] rounded-full"
          style={{ background: CH.accent }}
        />
      )}
    </button>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div
      className="rounded-lg px-6 py-12 text-center text-[13.5px]"
      style={{
        background: CH.panel,
        border: `1px dashed ${CH.border}`,
        color: CH.textDim,
      }}
    >
      {text}
    </div>
  );
}
