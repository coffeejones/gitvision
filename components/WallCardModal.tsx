"use client";

// Modal that previews the load-bearing walls share card and downloads a PNG.
// Mirrors ShareCardModal; the only difference is the content — it computes the
// refactor-safety report from the snapshot's code graph and renders WallCard.

import { useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisSnapshot } from "@/lib/types";
import { downloadCardPng } from "@/lib/shareCardImage";
import { TOK } from "@/lib/sessionTheme";
import { computeRefactorSafety } from "@/lib/refactorSafety";
import { WallCard, WALL_CARD_DIMS, type WallCardVariant } from "./WallCard";

interface Props {
  snapshot: AnalysisSnapshot;
  sessionName: string;
  open: boolean;
  onClose: () => void;
}

export function WallCardModal({ snapshot, sessionName, open, onClose }: Props) {
  const [variant, setVariant] = useState<WallCardVariant>("landscape");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Gated on `open`: this modal is mounted (closed) on every session route, so
  // computing the full refactor-safety pass at mount would waste a graph walk
  // on every page load for the majority of visits that never open the card.
  // Deferred to first open; still memoized across re-renders (variant flip,
  // download state).
  const report = useMemo(
    () => (open && snapshot.codeGraph ? computeRefactorSafety(snapshot.codeGraph) : null),
    [open, snapshot.codeGraph]
  );

  useEffect(() => {
    if (!open) return;
    setError(null); // clear a prior failed download so it doesn't persist on reopen
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

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
