"use client";

// Shared search-input primitive. Two tabs (Code, Packages) had near-identical
// inline search-input blocks that drifted apart slightly over the v0.9-v0.30
// timeline (different icon size, surface vs bg background, with/without
// onFocus handlers). One primitive keeps them in sync.
//
// Visual contract: full-width box with leading Search icon, input fills the
// rest. Height 36px (h-9). The container background defaults to TOK.bg so
// the input reads as "below" a TOK.surface card; pass `surface="elevated"`
// when the parent is on TOK.bg (Packages tab) for a one-shade-up look.
//
// NOT used by overlay-style inputs (Canvas / Imports filter-path inputs) —
// those are inline toolbar elements with their own much-tighter shape.

import { Search } from "lucide-react";
import { TOK } from "@/lib/theme";

interface Props {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  /** Surface to render on. "card" = TOK.bg (the input nests INSIDE a
   *  TOK.surface card and reads as a step down). "elevated" = TOK.surface
   *  (the input sits ON the page TOK.bg and reads as a step up). */
  surface?: "card" | "elevated";
  /** Wraps the focused-vs-blurred picker dropdown lifecycle. Optional —
   *  most search inputs don't need it. */
  onFocus?: () => void;
  onBlur?: () => void;
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  surface = "card",
  onFocus,
  onBlur,
}: Props) {
  const bg = surface === "elevated" ? TOK.surface : TOK.bg;
  return (
    <div
      className="flex items-center gap-2 px-3 h-9 rounded-lg"
      style={{
        background: bg,
        border: `1px solid ${TOK.border}`,
      }}
    >
      <Search size={13} style={{ color: TOK.textMuted }} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        className="flex-1 bg-transparent text-sm outline-none"
        style={{ color: TOK.textPrimary }}
      />
    </div>
  );
}
