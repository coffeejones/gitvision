// The Read — Adoption card (Mode A). Presentational only: the
// AdoptionRead object is computed server-side by
// lib/intelligence/adoptionRead.ts and passed in. Reframes the
// deterministic grade into an ADOPT / GUARDED / AVOID call you can
// paste into an RFC or PR to win the argument.
//
// Orange (TOK.rose, International Orange) is rationed: it appears only
// on an AVOID verdict word and on the single most-severe hesitation.
// ADOPT reads in bone, GUARDED in the dim amber tone.

import { Check, AlertCircle } from "lucide-react";
import { TOK } from "@/lib/sessionTheme";
import type { AdoptionRead, AdoptionReadLevel } from "@/lib/intelligence/adoptionRead";

const READ_COLOR: Record<AdoptionReadLevel, string> = {
  ADOPT: TOK.accent,
  GUARDED: TOK.amber,
  AVOID: TOK.rose,
};

const MONO = { fontFamily: "var(--font-mono)" } as const;

function Reason({
  reason,
  critical,
}: {
  reason: AdoptionRead["safe"][number];
  critical?: boolean;
}) {
  const dot = critical ? TOK.rose : TOK.textMuted;
  return (
    <div className="flex gap-3">
      <span
        className="shrink-0 rounded-full"
        style={{ width: 8, height: 8, marginTop: 6, background: dot }}
      />
      <div className="text-[13.5px] leading-relaxed" style={{ color: TOK.textSecondary }}>
        <span style={{ ...MONO, color: critical ? TOK.rose : TOK.textMuted }}>
          {reason.tag}
        </span>{" "}
        <span style={{ color: TOK.textMuted }}>—</span> {reason.text}
      </div>
    </div>
  );
}

export function AdoptionReadCard({ read }: { read: AdoptionRead }) {
  const headColor = READ_COLOR[read.read];
  const hesitateColor = read.criticalReasonId ? TOK.rose : TOK.amber;

  return (
    <section
      className="flex flex-col gap-5 rounded-xl p-6"
      style={{ background: TOK.surface, border: `1px solid ${TOK.border}` }}
    >
      {/* Eyebrow + reconcile grade chip */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span
              className="shrink-0 rounded-full"
              style={{ width: 7, height: 7, background: TOK.rose }}
            />
            <span
              className="text-[10px] uppercase tracking-[0.2em] font-medium"
              style={{ color: TOK.textMuted }}
            >
              The read · adoption
            </span>
          </div>
          {read.scopeNote && (
            <span className="text-[11.5px]" style={{ color: TOK.textMuted }}>
              {read.scopeNote}
            </span>
          )}
        </div>
        <div
          className="text-center rounded-lg shrink-0"
          style={{ border: `1px solid ${TOK.border}`, padding: "7px 12px" }}
        >
          <div
            className="text-[20px] font-semibold leading-none"
            style={{ color: TOK.textSecondary }}
          >
            {read.reconcile.grade}
          </div>
          <div
            className="text-[9px] tracking-[0.14em] mt-1.5"
            style={{ ...MONO, color: TOK.textMuted }}
          >
            OVERALL
          </div>
        </div>
      </div>

      {/* Hero verdict + headline */}
      <div className="flex items-baseline gap-4 flex-wrap">
        <span
          className="text-[44px] font-semibold leading-none"
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

      <div style={{ height: 1, background: TOK.border }} />

      {/* Reasons — safe vs hesitate */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div className="flex flex-col gap-3.5">
          <div
            className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] font-medium"
            style={{ color: TOK.textMuted }}
          >
            <Check size={14} style={{ color: TOK.accent }} />
            Why it&rsquo;s safe
          </div>
          {read.safe.length > 0 ? (
            read.safe.map((r) => <Reason key={r.id} reason={r} />)
          ) : (
            <span className="text-[13px]" style={{ color: TOK.textMuted }}>
              No standout strengths surfaced — weigh it on the risks.
            </span>
          )}
        </div>
        <div className="flex flex-col gap-3.5">
          <div
            className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] font-medium"
            style={{ color: TOK.textMuted }}
          >
            <AlertCircle size={14} style={{ color: hesitateColor }} />
            Why we&rsquo;d hesitate
          </div>
          {read.hesitate.length > 0 ? (
            read.hesitate.map((r) => (
              <Reason
                key={r.id}
                reason={r}
                critical={r.id === read.criticalReasonId}
              />
            ))
          ) : (
            <span className="text-[13px]" style={{ color: TOK.textMuted }}>
              No risks flagged.
            </span>
          )}
        </div>
      </div>

      {/* Guardrails */}
      <div style={{ height: 1, background: TOK.border }} />
      <div className="flex flex-col gap-3">
        <span
          className="text-[10px] uppercase tracking-[0.18em] font-medium"
          style={{ color: TOK.textMuted }}
        >
          If you adopt
        </span>
        <div className="flex flex-wrap gap-2">
          {read.guardrails.map((g, i) => (
            <span
              key={i}
              className="text-[12.5px] rounded-lg"
              style={{
                color: TOK.textSecondary,
                border: `1px solid ${TOK.border}`,
                padding: "6px 11px",
                background: TOK.bg,
              }}
            >
              {g}
            </span>
          ))}
        </div>
      </div>

      {/* Reconcile + trust line */}
      {read.reconcile.why && (
        <p className="text-[12.5px] leading-relaxed" style={{ color: TOK.textMuted }}>
          {read.reconcile.why}
        </p>
      )}
      <p
        className="text-[10.5px] leading-relaxed"
        style={{ ...MONO, color: TOK.textMuted, letterSpacing: "0.03em" }}
      >
        reweighted from 4 lenses · every line above is a computed signal, not AI
      </p>
    </section>
  );
}
