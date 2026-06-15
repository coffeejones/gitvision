"use client";

// Small "copy this finding's URL" button. Pairs with the deep-link URL
// params read by CodePanel + the multi-route session shell. Click →
// writes the URL to clipboard, shows a 1.5s "Copied!" badge, then
// resets.
//
// We deliberately don't use `navigator.share()` even though it'd be a
// nicer mobile UX — the share-sheet hides the URL behind a system
// dialog, which kills our "paste into Slack" use-case. Clipboard wins
// for desktop devs sharing in DMs / PRs / commit messages.

import { useEffect, useState } from "react";
import { Check, Link2 } from "lucide-react";
import { TOK } from "@/lib/sessionTheme";

interface Props {
  /** URL search params to attach to the current pathname. The button
   *  itself reads the current location, applies these params, and
   *  copies the result. Pass an object so callers don't have to
   *  worry about URL encoding. */
  params: Record<string, string | undefined>;
  /** Optional fragment (without the #) — useful for scrolling the
   *  recipient to a specific element. */
  hash?: string;
  /** Compact "icon-only" button vs label-bearing variant. Default
   *  compact — most uses are dense list rows. */
  variant?: "compact" | "labeled";
  /** Override the default tooltip text. */
  title?: string;
}

export function CopyLinkButton({
  params,
  hash,
  variant = "compact",
  title = "Copy link to this finding",
}: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  function buildUrl(): string {
    if (typeof window === "undefined") return "";
    const url = new URL(window.location.href);
    // Drop existing search params we'll overwrite, but keep ones the
    // caller doesn't mention — supports composition (e.g. coming from
    // an `?owner=...` param we don't know about).
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === "") {
        url.searchParams.delete(key);
      } else {
        url.searchParams.set(key, value);
      }
    }
    url.hash = hash ?? "";
    return url.toString();
  }

  async function copy() {
    const url = buildUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard API can throw in iframes or insecure contexts. Fall
      // back to a prompt so users can manually copy.
      window.prompt("Copy this URL:", url);
    }
  }

  if (variant === "labeled") {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          copy();
        }}
        className="text-[11px] inline-flex items-center gap-1.5 px-2 py-1 rounded transition cursor-pointer shrink-0"
        style={{
          background: TOK.surfaceElevated,
          color: copied ? TOK.accent : TOK.textSecondary,
          border: `1px solid ${copied ? TOK.accent : TOK.border}`,
        }}
        onMouseEnter={(e) => {
          if (!copied) e.currentTarget.style.borderColor = TOK.borderStrong;
        }}
        onMouseLeave={(e) => {
          if (!copied) e.currentTarget.style.borderColor = TOK.border;
        }}
        title={title}
      >
        {copied ? <Check size={11} /> : <Link2 size={11} />}
        <span>{copied ? "Copied" : "Copy link"}</span>
      </button>
    );
  }

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        copy();
      }}
      className="inline-flex items-center justify-center h-6 w-6 rounded transition cursor-pointer shrink-0"
      style={{
        color: copied ? TOK.accent : TOK.textMuted,
      }}
      onMouseEnter={(e) => {
        if (!copied) {
          e.currentTarget.style.background = TOK.surfaceElevated;
          e.currentTarget.style.color = TOK.textSecondary;
        }
      }}
      onMouseLeave={(e) => {
        if (!copied) {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = TOK.textMuted;
        }
      }}
      title={copied ? "Copied!" : title}
      aria-label={copied ? "URL copied" : title}
    >
      {copied ? <Check size={12} /> : <Link2 size={12} />}
    </button>
  );
}
