"use client";

// Modal that previews the reviewer-brief BlastCard at exact pixel dimensions
// (scaled to fit), lets the user flip landscape / square, and downloads a PNG.
// Mirrors ShareCardModal, but themed for the /preview marketing surface
// (CTSurface) — it uses the shared preview palette, not the session TOK tokens.

import { useEffect, useRef, useState } from "react";
import { X, Download } from "lucide-react";
import { downloadCardPng } from "@/lib/shareCardImage";
import type { ChangeBlastReport } from "@/lib/changeBlast/types";
import { BlastCard, BLAST_CARD_DIMS, type BlastCardVariant, type BlastCardPr } from "./BlastCard";
import { BONE, MUTED, BORDER, ORANGE } from "./previewTheme";

const PANEL = "#131110";
const DEEP = "#0a0908";
const ROSE = "#ff8a80";

interface Props {
  pr: BlastCardPr;
  report: ChangeBlastReport;
  open: boolean;
  onClose: () => void;
}

export function BlastCardModal({ pr, report, open, onClose }: Props) {
  const [variant, setVariant] = useState<BlastCardVariant>("landscape");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const dim = BLAST_CARD_DIMS[variant];

  async function download() {
    setDownloading(true);
    setError(null);
    try {
      await downloadCardPng(cardRef.current, {
        width: dim.w,
        height: dim.h,
        filename: `codetrawl-blast-${pr.owner}-${pr.repo}-${pr.number}-${variant}`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  // Scale the card to fit the viewport preview area.
  const previewMaxW = Math.min(960, typeof window !== "undefined" ? window.innerWidth - 120 : 960);
  const previewMaxH = Math.min(560, typeof window !== "undefined" ? window.innerHeight - 260 : 560);
  const scale = Math.min(previewMaxW / dim.w, previewMaxH / dim.h, 1);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,0.8)" }}
      onClick={onClose}
    >
      <div
        className="relative rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        style={{ maxWidth: "min(1040px, 95vw)", background: PANEL, border: `1px solid ${BORDER}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ borderBottom: `1px solid ${BORDER}` }}
        >
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold" style={{ color: BONE }}>
              Reviewer brief
            </h2>
            <span className="text-xs" style={{ color: MUTED, fontFamily: "var(--font-ct-mono, monospace)" }}>
              {dim.w}×{dim.h}
            </span>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded-lg transition hover:opacity-70"
            style={{ color: MUTED }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Preview */}
        <div
          className="flex-1 min-h-0 p-6 flex items-center justify-center overflow-hidden"
          style={{ background: DEEP }}
        >
          <div
            style={{
              width: dim.w * scale,
              height: dim.h * scale,
              position: "relative",
              borderRadius: 12,
              overflow: "hidden",
              boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
            }}
          >
            <div
              ref={cardRef}
              style={{
                transform: `scale(${scale})`,
                transformOrigin: "top left",
                width: dim.w,
                height: dim.h,
              }}
            >
              <BlastCard pr={pr} report={report} variant={variant} />
            </div>
          </div>
        </div>

        {/* Controls */}
        <div
          className="flex items-center justify-between gap-3 px-5 py-3"
          style={{ borderTop: `1px solid ${BORDER}`, background: PANEL }}
        >
          <div
            role="tablist"
            className="inline-flex gap-1 rounded-lg p-1"
            style={{ border: `1px solid ${BORDER}` }}
          >
            {(["landscape", "square"] as const).map((tab) => {
              const sel = variant === tab;
              return (
                <button
                  key={tab}
                  role="tab"
                  aria-selected={sel}
                  onClick={() => setVariant(tab)}
                  className="px-3 h-8 rounded-md text-sm font-medium transition"
                  style={{
                    background: sel ? ORANGE : "transparent",
                    color: sel ? "#0c0b0b" : MUTED,
                  }}
                >
                  {tab === "landscape" ? "Landscape · 1200×630" : "Square · 1080×1080"}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            {error && (
              <span className="text-sm" style={{ color: ROSE }}>
                {error}
              </span>
            )}
            <button
              onClick={download}
              disabled={downloading}
              className="h-9 px-4 rounded-lg text-sm font-medium hover:opacity-90 transition disabled:opacity-40 inline-flex items-center gap-2"
              style={{ background: ORANGE, color: "#0c0b0b" }}
            >
              <Download size={15} />
              {downloading ? "Rendering…" : "Download PNG"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
