// "Touch with care" panel for the session Overview (v0.58 / A2).
//
// Promotes blast-radius from a buried Code-tab feature to a discoverable
// Overview signal. Lists the top N functions whose changes ripple the
// furthest — concrete, scannable, with one-click drilldown.
//
// Each row deep-links to /session/{id}/code with the file, function name,
// container, and focus=blast pre-set, so the Code tab opens already
// scrolled to (and zoomed into) that function's full blast view. The
// transition feels "I clicked an interesting hub, now I see the whole map".
//
// Logic lives in lib/codeAnalysis/blastRanking.ts (pure rankFunctionsByBlast()).
// This component is a thin renderer: eyebrow, description, list, with a
// graceful empty state when no functions clear the threshold.

import Link from "next/link";
import { ArrowRight, Zap } from "lucide-react";
import type { RankedBlastFunction } from "@/lib/codeAnalysis/blastRanking";
import { STYLE, TOK } from "@/lib/sessionTheme";
import { HelpHint } from "@/components/HelpHint";

interface Props {
  ranked: RankedBlastFunction[];
  /** Session id — used to build absolute /session/{id}/code links. */
  sessionId: string;
}

export function BlastRadiusPanel({ ranked, sessionId }: Props) {
  // Don't render when there's nothing to show. Small repos, regex-fallback-
  // only languages, or repos without resolved call edges produce empty
  // rankings — the panel would just be a sad header.
  if (ranked.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <span
          className={`${STYLE.eyebrow} inline-flex items-center gap-1.5`}
          style={{ color: TOK.textMuted }}
        >
          Touch with care
          <HelpHint
            anchor="blast-radius"
            label="How blast radius (callers + callees) is computed"
          />
        </span>
        <span className="text-xs" style={{ color: TOK.textMuted }}>
          · functions whose changes ripple the furthest
        </span>
      </div>

      <div
        className="rounded-xl overflow-hidden"
        style={{
          background: TOK.surface,
          border: `1px solid ${TOK.border}`,
        }}
      >
        {ranked.map((fn, i) => (
          // startRow disambiguates overloaded methods (Java's
          // `login(String)` vs `login(String, String)` share path +
          // container + name but differ on line number).
          <BlastRow
            key={`${fn.filePath}::${fn.containerType ?? ""}::${fn.name}::${fn.startRow}`}
            fn={fn}
            sessionId={sessionId}
            isFirst={i === 0}
          />
        ))}
      </div>
    </section>
  );
}

function BlastRow({
  fn,
  sessionId,
  isFirst,
}: {
  fn: RankedBlastFunction;
  sessionId: string;
  isFirst: boolean;
}) {
  // Build the deep-link to Code tab focused on this function.
  // Mirrors the params CodePanel reads from URL on mount: file, fn,
  // container, focus=blast.
  const params = new URLSearchParams();
  params.set("file", fn.filePath);
  params.set("fn", fn.name);
  if (fn.containerType) params.set("container", fn.containerType);
  params.set("focus", "blast");
  const href = `/session/${sessionId}/code?${params.toString()}`;

  const displayName = fn.containerType
    ? `${fn.containerType}.${fn.name}`
    : fn.name;

  // Headline number — transitive incoming. The "+/200" suffix when the
  // BFS hit the cap signals the count is a lower bound.
  const blastNumber = fn.truncated
    ? `${fn.incomingCount}+`
    : `${fn.incomingCount}`;

  return (
    <Link
      href={href}
      className="group flex items-center gap-4 px-4 py-3 transition"
      style={{
        borderTop: isFirst ? "none" : `1px solid ${TOK.border}`,
      }}
    >
      {/* Big number block — instant scannable signal */}
      <div
        className="flex flex-col items-center justify-center shrink-0 rounded-lg px-3 py-2 min-w-[72px]"
        style={{
          background: TOK.amberSoft,
          color: TOK.amber,
          border: `1px solid ${TOK.amber}33`,
        }}
      >
        <span className="text-lg font-semibold tabular-nums leading-none">
          {blastNumber}
        </span>
        <span className="text-[10px] uppercase tracking-wider mt-1 opacity-80">
          fns
        </span>
      </div>

      {/* Function identity + supporting metadata */}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <Zap size={12} style={{ color: TOK.amber }} />
          <span
            className="font-mono text-sm font-medium truncate"
            style={{ color: TOK.textPrimary }}
            title={displayName}
          >
            {displayName}
          </span>
        </div>
        <div
          className="text-xs flex items-center gap-2 flex-wrap"
          style={{ color: TOK.textMuted }}
        >
          <span className="font-mono truncate" title={fn.filePath}>
            {fn.filePath}
          </span>
          <span>·</span>
          <span>
            cyclomatic{" "}
            <span style={{ color: TOK.textSecondary }}>{fn.complexity}</span>
          </span>
          <span>·</span>
          <span>
            <span style={{ color: TOK.textSecondary }}>
              {fn.directIncoming}
            </span>{" "}
            direct caller{fn.directIncoming === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      <ArrowRight
        size={14}
        className="shrink-0 opacity-40 group-hover:opacity-100 transition"
        style={{ color: TOK.textSecondary }}
      />
    </Link>
  );
}
