"use client";

// Modal that previews the load-bearing walls share card and downloads a PNG.
// Mirrors ShareCardModal and DriftCardModal; the content is a refactor-safety
// report over the snapshot's code graph.
//
// THE REPORT IS FETCHED WHEN THIS OPENS, not derived from a prop. This modal
// was the ONLY client component that needed snapshot.codeGraph, and because it
// is mounted (closed) on every session route, that one useMemo was why the
// entire graph rode along in the flight payload of every tab in the workspace —
// 5.59 MB of the zod session's 6.34 MB, on a page about pull requests.
//
// The compute was already deferred to first open, which was the right instinct;
// the DATA still travelled eagerly, and the data was the expensive part. Opening
// a share-card dialog is a deliberate act, so paying a roundtrip here is the
// right trade — and the report is counts plus a bounded file list, so what comes
// back is kilobytes.

import { useEffect, useRef, useState } from "react";
import type { ClientSnapshot } from "@/lib/clientSnapshot";
import type { RefactorSafetyReport } from "@/lib/refactorSafety";
import { downloadCardPng } from "@/lib/shareCardImage";
import { TOK } from "@/lib/sessionTheme";
import { getOrCreateOwnerId, OWNER_ID_HEADER } from "@/lib/ownerId";
import { WallCard, WALL_CARD_DIMS, type WallCardVariant } from "./WallCard";

interface Props {
  snapshot: ClientSnapshot;
  sessionId: string;
  sessionName: string;
  open: boolean;
  onClose: () => void;
}

export function WallCardModal({
  snapshot,
  sessionId,
  sessionName,
  open,
  onClose,
}: Props) {
  const [variant, setVariant] = useState<WallCardVariant>("landscape");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<RefactorSafetyReport | null>(null);
  const [loaded, setLoaded] = useState(false);
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

  // Fetch once per visit, and keep the result — reopening should not re-walk the
  // graph. The guard is `loaded`, not `report`: a snapshot with no code graph
  // answers `{ report: null }`, which is a real answer, and guarding on the
  // report itself would re-request it on every open forever.
  useEffect(() => {
    if (!open || loaded) return;
    const ac = new AbortController();
    setLoadError(null);
    // Send the legacy owner id. requireSessionReadAccessFromRequest reads only
    // the X-Owner-Id HEADER, while the page that renders this dialog accepts the
    // gv_owner_id COOKIE as well — so a private session on the legacy ladder
    // (ownerId, no userId) renders fine and then 404s here. Every other client
    // fetch in the app already sends it (SessionToolbar, SessionNameEditor,
    // RefineScope); these two share-card dialogs were the exceptions.
    const ownerId = getOrCreateOwnerId();
    fetch(`/api/sessions/${sessionId}/refactor-safety`, {
      signal: ac.signal,
      headers: ownerId ? { [OWNER_ID_HEADER]: ownerId } : {},
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Could not load the report"))))
      .then((body: { report: RefactorSafetyReport | null }) => {
        setReport(body.report);
        setLoaded(true);
      })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === "AbortError") return;
        setLoadError(e instanceof Error ? e.message : "Could not load the report");
      });
    return () => ac.abort();
  }, [open, loaded, sessionId]);

  if (!open) return null;

  const dim = WALL_CARD_DIMS[variant];
  // Require at least one high-tier file — a repo whose files are all
  // moderate/safe has no "load-bearing walls" to show, and rendering the card
  // anyway would put "The files nobody dares touch" over a "0 load-bearing"
  // footer (an overclaim on a public artifact).
  const hasData =
    report &&
    report.counts["load-bearing"] + report.counts["handle-with-care"] > 0;

  async function download() {
    setDownloading(true);
    setError(null);
    try {
      await downloadCardPng(cardRef.current, {
        width: dim.w,
        height: dim.h,
        filename: `codetrawl-${sessionName
          .replace(/\s+/g, "-")
          .toLowerCase()}-walls-${variant}`,
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
              Load-bearing walls
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
                <WallCard snapshot={snapshot} report={report!} variant={variant} />
              </div>
            </div>
          ) : loadError ? (
            <p className="text-sm text-center max-w-sm" style={{ color: TOK.rose }}>
              {loadError}
            </p>
          ) : !loaded ? (
            // The fetch, not the verdict. Distinct from the message below, which
            // is a real answer about the repo rather than a wait — showing "no
            // load-bearing walls" while the request is still in flight would
            // state a finding we do not have yet.
            <p className="text-sm text-center max-w-sm" style={{ color: TOK.textMuted }}>
              Measuring the walls…
            </p>
          ) : (
            <p className="text-sm text-center max-w-sm" style={{ color: TOK.textMuted }}>
              No load-bearing walls to show — this repo&rsquo;s files are
              loosely coupled, or there&rsquo;s no code graph on this snapshot
              yet. Refresh the session to rebuild the refactor-safety report.
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
