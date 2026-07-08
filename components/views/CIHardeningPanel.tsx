// CI-hardening panel (Arc 4 — Evidence Desk). Renders the GitHub Actions
// hardening assessment: action pinning, third-party inventory, token scope.
// Every finding is grounded in a named, dated incident ("this happened on this
// date"), never a bare best-practice. Thin renderer over CIHardeningReport.

import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import type {
  CIHardeningFinding,
  CIHardeningReport,
} from "@/lib/ciHardening/types";
import { STYLE, TOK } from "@/lib/sessionTheme";

interface Props {
  report: CIHardeningReport;
}

const SEV_COLOR: Record<CIHardeningFinding["severity"], string> = {
  high: TOK.rose,
  medium: TOK.amber,
  low: TOK.textMuted,
};

const POSTURE: Record<
  CIHardeningReport["posture"],
  { label: string; color: string; Icon: typeof ShieldAlert }
> = {
  exposed: { label: "Exposed", color: TOK.rose, Icon: ShieldAlert },
  attention: { label: "Needs attention", color: TOK.amber, Icon: ShieldQuestion },
  hardened: { label: "Hardened", color: TOK.accent, Icon: ShieldCheck },
};

export function CIHardeningPanel({ report }: Props) {
  const posture = POSTURE[report.posture];
  const pinned = report.actions.filter((a) => a.pin === "sha").length;
  const totalActions = report.actions.filter(
    (a) => a.pin !== "local" && a.pin !== "docker"
  ).length;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className={STYLE.eyebrow} style={{ color: TOK.textMuted }}>
          CI hardening
        </span>
        <span className="text-xs" style={{ color: TOK.textMuted }}>
          · {report.workflowCount} workflow
          {report.workflowCount === 1 ? "" : "s"} · action pinning, third-party
          inventory, token scope
        </span>
      </div>

      <div
        className="rounded-xl p-5 flex flex-col gap-5"
        style={{ background: TOK.surface, border: `1px solid ${TOK.border}` }}
      >
        {/* Posture + at-a-glance numbers */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <span
            className="inline-flex items-center gap-2 text-sm font-semibold px-2.5 py-1 rounded-md"
            style={{
              color: posture.color,
              background: `${posture.color}1a`,
              border: `1px solid ${posture.color}33`,
            }}
          >
            <posture.Icon size={14} />
            {posture.label}
          </span>
          <span
            className="text-xs font-mono tabular-nums"
            style={{ color: TOK.textMuted }}
          >
            {pinned}/{totalActions} actions SHA-pinned
          </span>
        </div>

        {report.findings.length === 0 ? (
          <p className="text-sm" style={{ color: TOK.textSecondary }}>
            Every action is pinned to a commit SHA and no workflow leaves the
            token over-scoped — this repo&rsquo;s CI is hardened against the
            action-tag supply-chain attacks that hit thousands of repos in 2025.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {report.findings.map((f) => (
              <li key={f.id} className="flex flex-col gap-2">
                <div className="flex items-baseline gap-2.5">
                  <span
                    className="mt-1.5 h-2 w-2 rounded-full shrink-0"
                    style={{ background: SEV_COLOR[f.severity] }}
                  />
                  <div className="flex flex-col gap-1.5 min-w-0">
                    <span
                      className="text-sm font-medium"
                      style={{ color: TOK.textPrimary }}
                    >
                      {f.title}
                    </span>
                    {f.incident && (
                      <span
                        className="text-xs leading-relaxed"
                        style={{ color: TOK.textMuted }}
                      >
                        <span style={{ color: SEV_COLOR[f.severity] }}>
                          Why:
                        </span>{" "}
                        <span style={{ color: TOK.textSecondary }}>
                          {f.incident.name}
                        </span>{" "}
                        ({f.incident.date}) — {f.incident.summary}
                      </span>
                    )}
                    {f.evidence.length > 0 && (
                      <details className="mt-0.5">
                        <summary
                          className="text-xs cursor-pointer select-none"
                          style={{ color: TOK.textMuted }}
                        >
                          {f.count > f.evidence.length
                            ? `Show ${f.evidence.length} of ${f.count}`
                            : `Show evidence (${f.evidence.length})`}
                        </summary>
                        <ul className="flex flex-col gap-1 mt-1.5 pl-1">
                          {f.evidence.map((e, i) => (
                            <li
                              key={i}
                              className="text-xs font-mono"
                              style={{ color: TOK.textSecondary }}
                            >
                              {e}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p
          className="text-[11px] pt-1"
          style={{ color: TOK.textMuted, borderTop: `1px solid ${TOK.border}`, paddingTop: 12 }}
        >
          Manifest-scoped: reflects the workflow files in{" "}
          <span className="font-mono">.github/workflows</span> at this snapshot.
          Pin actions to a full commit SHA and set an explicit least-privilege{" "}
          <span className="font-mono">permissions:</span> block to harden.
        </p>
      </div>
    </section>
  );
}
