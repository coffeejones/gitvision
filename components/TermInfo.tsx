"use client";

// TermInfo — a muted info affordance that reveals the glossary "what + why"
// for a jargon term, right where the term is used. Explanation stays within
// reach (hover / focus / tap) instead of one click away on /help — the
// landing's "read it like a manual" promise, made true in the workspace.
//
// Positioned FIXED from the trigger's rect on open, so it escapes the
// overflow-clipping of the dense panels it lives in (complexity chips,
// coverage badges, panel headers). Closes on leave / blur / Escape.
//
// Accessibility: the trigger is a real <button> (focusable, keyboard-openable),
// the popover is aria-describedby-linked, and the icon carries an aria-label.

import { useEffect, useId, useRef, useState } from "react";
import { Info } from "lucide-react";
import { TOK } from "@/lib/sessionTheme";
import { glossary, type GlossaryKey } from "@/lib/glossary";

export function TermInfo({ term, size = 11 }: { term: GlossaryKey; size?: number }) {
  const entry = glossary(term);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popId = useId();

  function place() {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const W = 300;
    // prefer above the icon; clamp horizontally into the viewport
    const left = Math.min(Math.max(12, r.left + r.width / 2 - W / 2), window.innerWidth - W - 12);
    const top = r.top - 10; // popover's bottom edge sits here (translateY(-100%))
    setPos({ left, top });
  }

  function show() {
    place();
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onScroll = () => setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return (
    <span
      className="inline-flex"
      style={{ verticalAlign: "middle" }}
      onMouseEnter={show}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={btnRef}
        type="button"
        aria-label={`What is ${entry.term}?`}
        aria-describedby={open ? popId : undefined}
        aria-expanded={open}
        onFocus={show}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          e.stopPropagation();
          open ? setOpen(false) : show();
        }}
        className="inline-flex items-center justify-center cursor-help transition"
        style={{ color: open ? TOK.textSecondary : TOK.textMuted, background: "transparent", border: 0, padding: 0 }}
      >
        <Info size={size} />
      </button>

      {open && pos && (
        <span
          id={popId}
          role="tooltip"
          onMouseEnter={() => setOpen(true)}
          style={{
            position: "fixed",
            left: pos.left,
            top: pos.top,
            transform: "translateY(-100%)",
            width: 300,
            zIndex: 80,
            display: "block",
            padding: "12px 14px",
            borderRadius: 10,
            background: TOK.surfaceElevated,
            border: `1px solid ${TOK.border}`,
            boxShadow: "0 12px 32px -8px rgba(0,0,0,0.55)",
            textTransform: "none",
            letterSpacing: "normal",
            pointerEvents: "auto",
          }}
        >
          <span className="block text-[12px] font-semibold" style={{ color: TOK.textPrimary }}>
            {entry.term}
          </span>
          <span className="block text-[12px] mt-1.5 leading-relaxed" style={{ color: TOK.textSecondary }}>
            {entry.what}
          </span>
          <span className="block text-[12px] mt-1.5 leading-relaxed" style={{ color: TOK.textMuted }}>
            {entry.why}
          </span>
          {entry.anchor && (
            <a
              href={`/help#${entry.anchor}`}
              target="_blank"
              rel="noopener"
              onClick={(e) => e.stopPropagation()}
              className="inline-block mt-2 text-[11px] font-mono hover:underline"
              style={{ color: TOK.accent }}
            >
              Read more →
            </a>
          )}
        </span>
      )}
    </span>
  );
}
