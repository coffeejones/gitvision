"use client";

// Tiny info-icon affordance that deep-links to a section on the
// /help page (v0.73).
//
// Use case: a panel header or label where the concept underneath
// isn't self-evident (McCabe complexity, blast radius, snapshot vs
// session). Clicking the icon opens /help in a new tab, scrolled
// to the relevant anchor — so the user can read the explanation
// without losing their place in the session they were navigating.
//
// What this component is NOT:
//   - A tooltip with full prose. Native title gives a 1-sentence
//     hint; deeper context lives on /help.
//   - A modal. Modals interrupt; deep-linking to a doc page
//     respects the user's flow.
//   - Visible by default. The icon is muted on purpose — present
//     but not shouting.
//
// Place sparingly. One per panel header / complex label, not per
// every small piece of UI chrome.
//
// "use client" required because the hover-color transition uses
// onMouseEnter/onMouseLeave handlers — those can't cross a Server
// Component boundary, and HelpHint gets used inside both server
// pages (imports route, help route) and client panels.

import { Info } from "lucide-react";
import { TOK } from "@/lib/sessionTheme";

interface Props {
  /** Anchor on /help (without the `#`). Must match an `id` on the
   *  /help page — see SECTIONS list there for the canonical set. */
  anchor: string;
  /** Short hint shown as a native browser tooltip on hover. Should
   *  fit in one sentence; deeper explanation lives on /help. */
  label: string;
  /** Override icon size. Default 11px keeps it visually subordinate
   *  to neighbouring text without disappearing. */
  size?: number;
}

export function HelpHint({ anchor, label, size = 11 }: Props) {
  return (
    <a
      href={`/help#${anchor}`}
      target="_blank"
      rel="noopener"
      title={`${label} — read more`}
      aria-label={`Help: ${label}`}
      className="inline-flex items-center justify-center transition cursor-help"
      style={{
        color: TOK.textMuted,
        // The hover bump up to textSecondary signals interactivity
        // without stealing attention from the actual content the
        // user came to read.
        verticalAlign: "middle",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = TOK.textSecondary;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = TOK.textMuted;
      }}
    >
      <Info size={size} />
    </a>
  );
}
