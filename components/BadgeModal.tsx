"use client";

// "README badge" modal (Arc 3 distribution) — previews the live /badge/[id]
// SVG and hands the user the markdown to paste into their README. The badge is
// an evergreen backlink: it re-fetches the current grade on every README view.

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { TOK } from "@/lib/sessionTheme";

interface Props {
  sessionId: string;
  isPrivate: boolean;
  open: boolean;
  onClose: () => void;
}

export function BadgeModal({ sessionId, isPrivate, open, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCopied(false);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  // Absolute URLs from the current origin — in production that's codetrawl.com,
  // so the copied markdown works verbatim in a real README.
  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://codetrawl.com";
  const badgeUrl = `${origin}/badge/${sessionId}`;
  const sessionUrl = `${origin}/session/${sessionId}`;
  const markdown = `[![CodeTrawl](${badgeUrl})](${sessionUrl})`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the snippet is visible to copy manually */
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onClick={onClose}
    >
      <div
        className="relative rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ maxWidth: "min(560px, 95vw)", background: TOK.surface, border: `1px solid ${TOK.border}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ borderBottom: `1px solid ${TOK.border}` }}
        >
          <h2 className="text-lg font-semibold" style={{ color: TOK.textPrimary }}>
            README badge
          </h2>
          <button
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded-lg transition"
            style={{ color: TOK.textMuted }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="p-6 flex flex-col gap-5" style={{ background: TOK.bgDeep }}>
          {/* Live preview */}
          <div
            className="flex items-center justify-center rounded-xl py-8"
            style={{ background: TOK.surface, border: `1px solid ${TOK.border}` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={badgeUrl}
              alt="CodeTrawl grade badge"
              style={{ height: 20 }}
            />
          </div>

          <p className="text-sm leading-relaxed" style={{ color: TOK.textSecondary }}>
            The badge shows this session&rsquo;s current verdict grade and its
            trend since the last sweep. It refreshes on every README view —
            paste this markdown wherever you want an always-current backlink.
          </p>

          {isPrivate && (
            <p
              className="text-xs rounded-lg px-3 py-2"
              style={{ color: TOK.textMuted, background: TOK.surface, border: `1px solid ${TOK.border}` }}
            >
              This session is from a private repo, so the badge shows{" "}
              <span className="font-mono">private</span> instead of a grade —
              it never exposes a private repo&rsquo;s score.
            </p>
          )}

          {/* Markdown snippet */}
          <div className="flex flex-col gap-2">
            <div
              className="rounded-lg px-3 py-2.5 text-xs font-mono break-all"
              style={{ background: TOK.surface, border: `1px solid ${TOK.border}`, color: TOK.textSecondary }}
            >
              {markdown}
            </div>
            <button
              onClick={copy}
              className="h-9 px-4 rounded-lg text-sm font-medium hover:opacity-90 transition inline-flex items-center gap-2 self-start"
              style={{ background: TOK.accent, color: TOK.accentOn }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? "Copied" : "Copy markdown"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
