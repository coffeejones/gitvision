// QuickLookCard — one Workspace tile on the Overview: an icon, a label, the
// headline stat for that tab, and a one-line description of what is behind it.
//
// Moved out of app/session/[id]/page.tsx unchanged, and it stays out. The
// extraction was made so the landing's hero shot could mount a real Workspace
// tile instead of copying sixty lines of one; that shot has since been dropped
// from the landing, but a self-contained presentational card belongs beside its
// thirty siblings in components/views/ rather than buried in a 600-line route
// either way. The Overview renders it exactly as it always did.

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { TOK } from "@/lib/sessionTheme";

interface QuickLookCardProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  stat: string;
  description: string;
  /** Subtle accent border when there's something interesting on this
   *  tab (e.g. duplicate groups, untested hotspots). Draws the eye. */
  accent?: boolean;
  /** Rose accent border when there's a problem (e.g. CVEs). Stronger
   *  visual pull than the green accent. */
  warn?: boolean;
}

export function QuickLookCard({
  href,
  icon,
  label,
  stat,
  description,
  accent,
  warn,
}: QuickLookCardProps) {
  const borderColor = warn ? `${TOK.rose}33` : accent ? `${TOK.accent}33` : TOK.border;
  return (
    <Link
      href={href}
      // Material card recipe (diagonal gradient + 1px ambient shadow)
      // matching WorkspaceCard / StatTile across the rest of the app.
      // Hover-lift via translate-y so the cursor's path is rewarded
      // with motion — same pattern as WorkspaceCard.
      className="group flex flex-col gap-2 p-5 rounded-xl transition-all duration-300 hover:-translate-y-0.5"
      style={{
        background: TOK.surface,
        border: `1px solid ${borderColor}`,
      }}
    >
      <div className="flex items-center gap-2">
        <span
          style={{
            color: warn ? TOK.rose : accent ? TOK.accent : TOK.textSecondary,
          }}
        >
          {icon}
        </span>
        <span
          className="text-sm font-medium"
          style={{ color: TOK.textPrimary }}
        >
          {label}
        </span>
        <ArrowRight
          size={13}
          className="ml-auto opacity-40 group-hover:opacity-100 transition"
          style={{ color: TOK.textSecondary }}
        />
      </div>
      <div
        className="text-xs font-mono tabular-nums"
        style={{ color: TOK.textPrimary }}
      >
        {stat}
      </div>
      <div className="text-[11px]" style={{ color: TOK.textMuted }}>
        {description}
      </div>
    </Link>
  );
}