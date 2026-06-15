"use client";

// Scope-filter dropdown for the Architecture tab (v0.70 polish).
//
// Real-world repos surface 100+ classes — Mermaid renders them as a
// horizontal stripe of unreadable mini-boxes when shown all at once.
// This dropdown lets the user scope the diagram to a single folder,
// shrinking it to something scannable (typically 5-30 entities).
//
// State lives in the URL (?scope=lib%2Fintelligence) so the choice
// is shareable + bookmarkable, and refreshes preserve it. Server
// re-runs generateClassDiagram with the picked scope and re-paints
// — no client-side Mermaid regeneration required.

import { useRouter, useSearchParams } from "next/navigation";
import { Filter } from "lucide-react";
import type { ScopeOption } from "@/lib/intelligence/classDiagram";
import { TOK } from "@/lib/sessionTheme";

interface Props {
  /** Folders sorted by class-count desc, computed server-side via
   *  computeScopeOptions(cg). Doesn't include the "all" option —
   *  this component prepends it. */
  options: ScopeOption[];
  /** Total class count across the whole repo (the "All" option
   *  count). */
  totalClasses: number;
  /** Currently-applied scope folder. Empty string when scope=all
   *  is active. */
  currentScope: string;
}

export function ArchitectureScope({
  options,
  totalClasses,
  currentScope,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function handleChange(value: string) {
    // Build new query string preserving any other params. Empty
    // value = "all" → drop the scope param entirely so the URL
    // stays clean.
    const next = new URLSearchParams(searchParams.toString());
    if (value === "") next.delete("scope");
    else next.set("scope", value);
    const qs = next.toString();
    router.push(qs ? `?${qs}` : "?", { scroll: false });
  }

  return (
    <div className="flex items-center gap-2">
      <Filter size={11} style={{ color: TOK.textMuted }} />
      <span
        className="text-[11px] uppercase tracking-wider"
        style={{ color: TOK.textMuted }}
      >
        Scope
      </span>
      <select
        value={currentScope}
        onChange={(e) => handleChange(e.target.value)}
        className="text-xs px-2 py-1 rounded-md transition cursor-pointer"
        style={{
          background: TOK.surface,
          color: TOK.textPrimary,
          border: `1px solid ${TOK.border}`,
          // Native select arrow stays — no need for a custom one
          // when system styling matches the dark theme decently.
        }}
      >
        <option value="">All ({totalClasses})</option>
        {options.map((opt) => (
          <option key={opt.folder} value={opt.folder}>
            {opt.folder} ({opt.classCount})
          </option>
        ))}
      </select>
    </div>
  );
}
