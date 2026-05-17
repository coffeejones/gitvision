"use client";

// Client wrapper for feedback in server-rendered surfaces (v0.74).
//
// The footer of MarketingHome is server-rendered for fast first paint.
// Feedback needs interactive state (modal open/closed) which can't live
// in a Server Component. This small wrapper bridges the two: renders
// as a plain anchor-styled <button>, opens FeedbackModal on click.
//
// Used by MarketingHome's footer "Feedback" link. Anywhere that wants
// a feedback CTA from inside a Server Component should reach for this.

import { useState } from "react";
import { FeedbackModal } from "./FeedbackModal";

interface Props {
  className?: string;
  /** Optional inline style — useful when callers need precise color
   *  control (e.g. the nav-bar Feedback pill uses TOK.accent values
   *  via theme tokens that Tailwind v4 arbitrary-value classes don't
   *  always render reliably). */
  style?: React.CSSProperties;
  /** Optional session id — only set when this link sits inside a
   *  session context. The marketing footer leaves it undefined. */
  sessionId?: string;
  children: React.ReactNode;
}

export function FeedbackLink({ className, style, sessionId, children }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className}
        style={style}
      >
        {children}
      </button>
      <FeedbackModal
        open={open}
        onClose={() => setOpen(false)}
        sessionId={sessionId}
      />
    </>
  );
}
