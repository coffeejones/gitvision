// Reusable empty-state shell (v0.75 polish track).
//
// Empty states are first-impression UX. A blank tab with one line of
// "No data" prose tells a new user nothing about what GitVision is
// supposed to show. A consistent shell with an icon, a heading, and a
// short helper paragraph sets expectations: "this panel WOULD show X
// if your repo had Y — here's why it's empty for you specifically".
//
// Usage:
//
//   <EmptyPanel
//     icon={<Network size={22} />}
//     title="No file-to-file imports detected"
//     body="GitVision builds the import graph for JS/TS, Python, ..."
//     hint="Click Refresh in the topbar to regenerate."
//   />
//
// Keep titles short (<60 chars), bodies medium (1-3 sentences),
// hints actionable. The dashed border + low-contrast styling are
// intentional — the goal is "calmly explain", not "alarm".

import type { ReactNode } from "react";
import { TOK } from "@/lib/theme";

interface Props {
  /** Lucide icon (or any ReactNode) shown above the title. */
  icon?: ReactNode;
  /** One-line headline. Keep under ~60 characters so it doesn't wrap
   *  awkwardly on narrow viewports. */
  title: string;
  /** Optional paragraph explaining what this panel would show given
   *  the right inputs. 1-3 sentences. */
  body?: ReactNode;
  /** Optional secondary line — usually an action ("Click Refresh")
   *  or a deeper context note. Rendered smaller and dimmer. */
  hint?: ReactNode;
  /** Override padding for tight spaces (e.g. inside a smaller card). */
  size?: "sm" | "md" | "lg";
}

const PADDING = {
  sm: "p-6",
  md: "p-8",
  lg: "p-10",
} as const;

export function EmptyPanel({
  icon,
  title,
  body,
  hint,
  size = "md",
}: Props) {
  return (
    <div
      className={`rounded-xl border border-dashed ${PADDING[size]} text-center text-sm flex flex-col items-center gap-2.5`}
      style={{
        borderColor: TOK.border,
        color: TOK.textMuted,
      }}
    >
      {icon && (
        <span style={{ color: TOK.textSecondary, marginBottom: 2 }}>
          {icon}
        </span>
      )}
      <p
        className="font-medium"
        style={{ color: TOK.textSecondary }}
      >
        {title}
      </p>
      {body && (
        <p className="max-w-xl leading-relaxed">
          {body}
        </p>
      )}
      {hint && (
        <p className="text-[11px] max-w-xl mt-1">
          {hint}
        </p>
      )}
    </div>
  );
}
