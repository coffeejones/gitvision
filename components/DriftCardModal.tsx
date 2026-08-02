"use client";

// Modal that previews the drift "direction of travel" share card and downloads
// a PNG. Mirrors WallCardModal; the difference is the content — a DriftReport
// spanning every snapshot's fingerprint rather than one snapshot's numbers.
//
// THE REPORT IS FETCHED WHEN THIS OPENS, not handed down as a prop. It used to
// be computed in app/session/[id]/layout.tsx, so all seventeen session tabs paid
// for it on every navigation to fill a dialog that starts closed. Worse than the
// JSON: computeDriftTrends compares the OLDEST and NEWEST snapshots, and 55 of
// the 57 snapshots on disk have no persisted fingerprint, so it walked two whole
// code graphs — 2.1 ms on gin, 7.9 on zod, 8.5 on our own repo, every page load.
//
// Opening a share-card dialog is a deliberate act, so paying the cost here is
// the right trade. It also freed the session layout of any need for snapshot[0].

import { useEffect, useRef, useState } from "react";
import type { ClientSnapshot } from "@/lib/clientSnapshot";
import type { DriftReport } from "@/lib/driftMetrics";
import { downloadCardPng } from "@/lib/shareCardImage";
import { TOK } from "@/lib/sessionTheme";
import { getOrCreateOwnerId, OWNER_ID_HEADER } from "@/lib/ownerId";
import { DriftCard, DRIFT_CARD_DIMS, type DriftCardVariant } from "./DriftCard";

interface Props {
  snapshot: ClientSnapshot;
  sessionId: string;
  sessionName: string;
  open: boolean;
  onClose: () => void;
}

export function DriftCardModal({
  snapshot,
  sessionId,
  sessionName,
  open,
  onClose,
}: Props) {
  const [variant, setVariant] = useState<DriftCardVariant>("landscape");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<DriftReport | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setError(null); // clear a prior failed download so it doesn't persist on reopen
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Fetch once per open, and keep the result — reopening the same dialog in one
  // visit should not re-walk the graphs. Aborted if the dialog closes first.
  useEffect(() => {
    if (!open || report) return;
    const ac = new AbortController();
    setLoadError(null);
    // Send the legacy owner id. requireSessionReadAccessFromRequest reads only
    // the X-Owner-Id HEADER, while the page that renders this dialog accepts the
    // gv_owner_id COOKIE as well — so a private session on the legacy ladder
    // (ownerId, no userId) renders fine and then 404s here. Every other client
    // fetch in the app already sends it (SessionToolbar, SessionNameEditor,
    // RefineScope); these two share-card dialogs were the exceptions.
    const ownerId = getOrCreateOwnerId();
    fetch(`/api/sessions/${sessionId}/drift`, {
      signal: ac.signal,
      headers: ownerId ? { [OWNER_ID_HEADER]: ownerId } : {},
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Could not load drift"))))
      .then((r: DriftReport) => setReport(r))
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === "AbortError") return;
        setLoadError(e instanceof Error ? e.message : "Could not load drift");
      });
    return () => ac.abort();
  }, [open, report, sessionId]);

  if (!open) return null;

  const dim = DRIFT_CARD_DIMS[variant];
  const hasData = !!report && report.hasBaseline && report.trends.length > 0;

  async function download() {
    setDownloading(true);
    setError(null);
    try {
      await downloadCardPng(cardRef.current, {
        width: dim.w,
        height: dim.h,
        filename: `codetrawl-${sessionName
          .replace(/\s+/g, "-")
          .toLowerCase()}-drift-${variant}`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  const previewMaxW = Math.min(960, typeof window !== "undefined" ? window.innerWidth - 120 : 960);
  const previewMaxH = Math.min(620, typeof window !== "undefined" ? window.innerHeight - 260 : 620);
  const scale = Math.min(previewMaxW / dim.w, previewMaxH / dim.h, 1);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onClick={onClose}
    >
      <div
        className="relative rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        style={{ maxWidth: "min(1040px, 95vw)", background: TOK.surface, border: `1px solid ${TOK.border}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ borderBottom: `1px solid ${TOK.border}` }}
        >
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold" style={{ color: TOK.textPrimary }}>
              Drift · direction of travel
            </h2>
            <span className="text-xs" style={{ color: TOK.textMuted }}>
              {dim.w}×{dim.h}
            </span>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded-lg transition"
            style={{ color: TOK.textMuted }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div
          className="flex-1 min-h-0 p-6 flex items-center justify-center overflow-hidden"
          style={{ background: TOK.bgDeep }}
        >
          {hasData ? (
            <div
              style={{
                width: dim.w * scale,
                height: dim.h * scale,
                position: "relative",
                borderRadius: 12,
                overflow: "hidden",
                boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
              }}
            >
              <div
                ref={cardRef}
                style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: dim.w, height: dim.h }}
              >
                <DriftCard snapshot={snapshot} report={report} variant={variant} />
              </div>
            </div>
          ) : loadError ? (
            <p className="text-sm text-center max-w-sm" style={{ color: TOK.rose }}>
              {loadError}
            </p>
          ) : !report ? (
            // The fetch, not the card. Distinct from the "needs two sweeps"
            // message below, which is a real answer rather than a wait.
            <p className="text-sm text-center max-w-sm" style={{ color: TOK.textMuted }}>
              Comparing sweeps…
            </p>
          ) : (
            <p className="text-sm text-center max-w-sm" style={{ color: TOK.textMuted }}>
              Drift needs at least two sweeps to compare. Refresh this session
              again over time — once a second snapshot lands (and something
              moves), the direction-of-travel card can render.
            </p>
          )}
        </div>

        <div
          className="flex items-center justify-between gap-3 px-5 py-3"
          style={{ borderTop: `1px solid ${TOK.border}`, background: TOK.surface }}
        >
          <div
            role="tablist"
            className="inline-flex gap-1 rounded-lg p-1"
            style={{ border: `1px solid ${TOK.border}` }}
          >
            {(["landscape", "square"] as const).map((v) => {
              const sel = variant === v;
              return (
                <button
                  key={v}
                  role="tab"
                  aria-selected={sel}
                  onClick={() => setVariant(v)}
                  className="px-3 h-8 rounded-md text-sm font-medium transition"
                  style={{ background: sel ? TOK.accent : "transparent", color: sel ? TOK.accentOn : TOK.textSecondary }}
                >
                  {v === "landscape" ? "Landscape · 1200×630" : "Square · 1080×1080"}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            {error && (
              <span className="text-sm" style={{ color: TOK.rose }}>
                {error}
              </span>
            )}
            <button
              onClick={download}
              disabled={downloading || !hasData}
              className="h-9 px-4 rounded-lg text-sm font-medium hover:opacity-90 transition disabled:opacity-40"
              style={{ background: TOK.accent, color: TOK.accentOn }}
            >
              {downloading ? "Rendering…" : "Download PNG"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
