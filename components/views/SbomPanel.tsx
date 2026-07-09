// SBOM export panel (Arc 4 — Evidence Desk). Pro-only: a timestamped CycloneDX
// or SPDX bill of materials for the snapshot, downloaded from the session's
// /sbom route. Non-Pro viewers see the value-led UpgradePrompt instead. Pure
// server component — the downloads are plain anchors (Content-Disposition does
// the work), no client JS.

import { Download, Package } from "lucide-react";
import { STYLE, TOK } from "@/lib/sessionTheme";
import { UpgradePrompt } from "@/components/billing/UpgradePrompt";

interface Props {
  sessionId: string;
  /** Components the SBOM would contain (0 = not captured on this snapshot). */
  componentCount: number;
  /** Whether the viewer's plan unlocks SBOM export (Pro). */
  entitled: boolean;
}

export function SbomPanel({ sessionId, componentCount, entitled }: Props) {
  if (!entitled) {
    return (
      <UpgradePrompt
        featureName="the evidence pack"
        requiredTier="full-bench"
        context="Download a timestamped evidence pack — SBOM (CycloneDX + SPDX), dependency health, CI-hardening, secret-hygiene, and the re-sweep trail in one zip — evidence for a security review or your CRA technical file."
      />
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className={STYLE.eyebrow} style={{ color: TOK.textMuted }}>
          Evidence pack
        </span>
        <span className="text-xs" style={{ color: TOK.textMuted }}>
          · timestamped bundle — SBOM, dep-health, CI-hardening, secret-hygiene, trail
        </span>
      </div>

      <div
        className="rounded-xl p-5 flex flex-col gap-4"
        style={{ background: TOK.surface, border: `1px solid ${TOK.border}` }}
      >
        <p className="text-sm leading-relaxed" style={{ color: TOK.textSecondary }}>
          A timestamped <span className="font-mono">.zip</span> you can hand to a
          security reviewer: the SBOM (CycloneDX + SPDX), dependency health,
          CI-hardening findings, a secret-hygiene summary, and the full re-sweep
          trail — with an explicit scope statement.
        </p>

        <div className="flex flex-wrap gap-3">
          <a
            href={`/session/${sessionId}/evidence`}
            download
            className="h-9 px-4 rounded-lg text-sm font-medium inline-flex items-center gap-2 hover:opacity-90 transition"
            style={{ background: TOK.accent, color: TOK.accentOn }}
          >
            <Package size={14} />
            Evidence pack <span className="font-mono opacity-70">.zip</span>
          </a>
        </div>

        {/* SBOM on its own, when the snapshot captured a component list. */}
        <div
          className="flex flex-col gap-3 pt-3"
          style={{ borderTop: `1px solid ${TOK.border}` }}
        >
          {componentCount === 0 ? (
            <p className="text-xs leading-relaxed" style={{ color: TOK.textMuted }}>
              The SBOM isn&rsquo;t in the pack yet — refresh the session so the
              next sweep records every declared dependency, then it&rsquo;s
              included and downloadable on its own below.
            </p>
          ) : (
            <>
              <p className="text-xs" style={{ color: TOK.textMuted }}>
                Or take the SBOM alone —{" "}
                <strong style={{ color: TOK.textSecondary }}>{componentCount}</strong>{" "}
                declared components, each purl-identified:
              </p>
              <div className="flex flex-wrap gap-3">
                <a
                  href={`/session/${sessionId}/sbom?format=cyclonedx`}
                  download
                  className="h-8 px-3 rounded-lg text-xs font-medium inline-flex items-center gap-2 hover:bg-white/5 transition"
                  style={{ color: TOK.textSecondary, border: `1px solid ${TOK.border}` }}
                >
                  <Download size={13} />
                  CycloneDX <span className="font-mono opacity-70">.cdx.json</span>
                </a>
                <a
                  href={`/session/${sessionId}/sbom?format=spdx`}
                  download
                  className="h-8 px-3 rounded-lg text-xs font-medium inline-flex items-center gap-2 hover:bg-white/5 transition"
                  style={{ color: TOK.textSecondary, border: `1px solid ${TOK.border}` }}
                >
                  <Download size={13} />
                  SPDX <span className="font-mono opacity-70">.spdx.json</span>
                </a>
              </div>
            </>
          )}
        </div>

        <p
          className="text-[11px] pt-1"
          style={{ color: TOK.textMuted, borderTop: `1px solid ${TOK.border}`, paddingTop: 12 }}
        >
          CycloneDX 1.5 + SPDX 2.3. Component identity, versions, purls, and
          dependency relationships are complete; supplier and licenses are{" "}
          <span className="font-mono">NOASSERTION</span> (a known-unknown) in this
          version. Manifest-scoped — direct declared dependencies; packages that
          enter off-manifest aren&rsquo;t represented. Secret hygiene is included
          as counts only, never values.
        </p>
      </div>
    </section>
  );
}
