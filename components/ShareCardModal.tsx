"use client";

// Modal that previews the share card at exact pixel dimensions (scaled to fit),
// lets the user flip variant (landscape / square), and downloads a PNG.

import { useEffect, useRef, useState } from "react";
import type { ClientSnapshot } from "@/lib/clientSnapshot";
import { downloadCardPng } from "@/lib/shareCardImage";
import { TOK } from "@/lib/sessionTheme";
import {
  ShareCard,
  SHARE_CARD_DIMS,
  type ShareCardVariant,
} from "./ShareCard";

interface Props {
  snapshot: ClientSnapshot;
  sessionName: string;
  open: boolean;
  onClose: () => void;
}

export function ShareCardModal({
  snapshot,
  sessionName,
  open,
  onClose,
}: Props) {
  const [variant, setVariant] = useState<ShareCardVariant>("landscape");
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

  const dim = SHARE_CARD_DIMS[variant];

  async function download() {
    setDownloading(true);
    setError(null);
    try {
      await downloadCardPng(cardRef.current, {
        width: dim.w,
        height: dim.h,
        filename: `codetrawl-${sessionName
          .replace(/\s+/g, "-")
          .toLowerCase()}-${variant}`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  // Scale the card to fit the viewport preview area
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
        style={{
          maxWidth: "min(1040px, 95vw)",
          background: TOK.surface,
          border: `1px solid ${TOK.border}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ borderBottom: `1px solid ${TOK.border}` }}
        >
          <div className="flex items-center gap-3">
            <h2
              className="text-lg font-semibold"
              style={{ color: TOK.textPrimary }}
            >
              Share card
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

        {/* Preview */}
        <div
          className="flex-1 min-h-0 p-6 flex items-center justify-center overflow-hidden"
          style={{ background: TOK.bgDeep }}
        >
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
              style={{
                transform: `scale(${scale})`,
                transformOrigin: "top left",
                width: dim.w,
                height: dim.h,
              }}
            >
              <ShareCard snapshot={snapshot} variant={variant} />
            </div>
          </div>
        </div>

        {/* Controls */}
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
                  style={{
                    background: sel ? TOK.accent : "transparent",
                    color: sel ? TOK.accentOn : TOK.textSecondary,
                  }}
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
            <span
              className="text-xs hidden sm:inline"
              style={{ color: TOK.textMuted }}
            >
              OG / Twitter / LinkedIn · Instagram
            </span>
            <button
              onClick={download}
              disabled={downloading}
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
