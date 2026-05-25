// IncidentsSection — Supply-chain incident matches (#19) for
// /session/[id]/security (v0.81+).
//
// One card per matched incident. Each card surfaces:
//   - Incident name + discovery date eyebrow
//   - Short description of what the attack did
//   - Matched packages (mono, ecosystem-prefixed)
//   - "Read advisory →" link to the public source
//
// Clean state shows scan scope ("10 curated incidents in DB") so
// visitors see what we checked even when nothing matched.

import { AlertOctagon, ArrowUpRight, ShieldCheck } from "lucide-react";
import { TOK } from "@/lib/theme";
import {
  KNOWN_INCIDENTS,
  type IncidentMatch,
} from "@/lib/security/knownIncidents";
import { SectionHeader } from "./SectionHeader";

export function IncidentsSection({
  matches,
}: {
  matches: IncidentMatch[];
}) {
  const hasMatches = matches.length > 0;

  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        title="Supply-chain incidents"
        subtitle="Curated database of documented attacks where specific package versions are confirmed compromised."
        statusLabel={
          hasMatches
            ? `${matches.length} match${matches.length === 1 ? "" : "es"}`
            : "Clean"
        }
        statusColor={hasMatches ? TOK.rose : TOK.accent}
      />

      {hasMatches ? (
        <div className="flex flex-col gap-3">
          {matches.map(({ incident, matchedPackages }) => (
            <article
              key={incident.id}
              className="flex flex-col gap-3 p-5 rounded-lg"
              style={{
                background: TOK.surface,
                border: `1px solid ${TOK.border}`,
              }}
            >
              <header className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1 min-w-0">
                  <span
                    className="text-[10px] uppercase tracking-[0.14em] font-medium"
                    style={{ color: TOK.textMuted }}
                  >
                    Discovered {incident.discoveredAt}
                  </span>
                  <h3
                    className="text-base font-semibold tracking-tight"
                    style={{
                      color: TOK.textPrimary,
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {incident.name}
                  </h3>
                </div>
                <span
                  className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
                  style={{
                    background: `${TOK.rose}1a`,
                    color: TOK.rose,
                    border: `1px solid ${TOK.rose}40`,
                  }}
                >
                  <AlertOctagon size={10} />
                  HIGH
                </span>
              </header>

              <p
                className="text-sm leading-relaxed"
                style={{ color: TOK.textSecondary }}
              >
                {incident.shortDescription}
              </p>

              <div
                className="flex flex-col gap-1.5 pt-3"
                style={{ borderTop: `1px solid ${TOK.border}` }}
              >
                <span
                  className="text-[10px] uppercase tracking-[0.14em] font-medium"
                  style={{ color: TOK.textMuted }}
                >
                  Matched in your dependencies
                </span>
                <ul className="flex flex-col gap-0.5">
                  {matchedPackages.map((p) => (
                    <li
                      key={p}
                      className="text-xs font-mono"
                      style={{ color: TOK.textPrimary }}
                    >
                      {p}
                    </li>
                  ))}
                </ul>
              </div>

              <a
                href={incident.reference}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium hover:underline transition w-fit"
                style={{ color: TOK.accent }}
              >
                Read advisory
                <ArrowUpRight size={12} />
              </a>
            </article>
          ))}
        </div>
      ) : (
        <CleanState
          summary={`No matches across ${KNOWN_INCIDENTS.length} curated incidents.`}
          detail="The scanner checks dependency versions against a hand-curated list of documented supply-chain attacks (npm, PyPI, Cargo). Quarterly review cadence."
        />
      )}
    </section>
  );
}

function CleanState({
  summary,
  detail,
}: {
  summary: string;
  detail: string;
}) {
  return (
    <div
      className="flex items-start gap-3 px-4 py-3 rounded-lg"
      style={{
        background: "rgba(255, 255, 255, 0.02)",
        border: `1px solid ${TOK.border}`,
      }}
    >
      <ShieldCheck
        size={14}
        style={{ color: TOK.accent, flexShrink: 0, marginTop: 2 }}
      />
      <div className="flex flex-col gap-0.5">
        <p className="text-sm" style={{ color: TOK.textPrimary }}>
          {summary}
        </p>
        <p className="text-xs" style={{ color: TOK.textMuted }}>
          {detail}
        </p>
      </div>
    </div>
  );
}
