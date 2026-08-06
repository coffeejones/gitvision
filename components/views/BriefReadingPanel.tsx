"use client";

// The reading, above the findings it was written from.
//
// It sits ON TOP of the deterministic brief, never instead of it. Everything
// the paragraph says is visible underneath in its evidenced form — that is the
// arrangement, and it is why the panel is allowed to exist at all on a product
// whose claim is "computed, never generated".
//
// Which is also why the button says "Read the findings", not "Analyse". The
// analysis already happened; this only puts it into a sentence.

import { useState } from "react";
import { Sparkles } from "lucide-react";

import { TOK } from "@/lib/sessionTheme";
import { getOrCreateOwnerId, OWNER_ID_HEADER } from "@/lib/ownerId";
import type { BriefReading } from "@/lib/brief/reading";

interface Props {
  sessionId: string;
  subject: string;
  /** A reading already stored on the snapshot, if this question was asked
   *  before. Readings are cached per subject, so asking one does not pay for
   *  three. */
  initial?: BriefReading | null;
  /** False when ANTHROPIC_API_KEY is unset. The brief is fully usable without
   *  it, so the panel disappears rather than offering a button that 502s. */
  available: boolean;
  /** Read-only view (public demo sessions): show a baked reading, never the
   *  control that would spend the owner's budget. */
  readOnly?: boolean;
}

export function BriefReadingPanel({
  sessionId,
  subject,
  initial,
  available,
  readOnly = false,
}: Props) {
  const [reading, setReading] = useState<BriefReading | null>(initial ?? null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!available && !reading) return null;
  if (readOnly && !reading) return null;

  async function generate() {
    setPending(true);
    setError(null);
    try {
      const ownerId = getOrCreateOwnerId();
      const res = await fetch(`/api/sessions/${sessionId}/brief/${subject}`, {
        method: "POST",
        headers: ownerId ? { [OWNER_ID_HEADER]: ownerId } : {},
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed (HTTP ${res.status})`);
      setReading(body.reading as BriefReading);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className={`flex flex-col rounded-xl px-5 ${reading ? "gap-3 py-4" : "py-2.5"}`}
      style={{ border: `1px solid ${TOK.border}`, background: TOK.surface }}
    >
      {/* One row until there is something to show. Before the reading exists
          this was a 100px card explaining that the findings work without it —
          a lot of space to spend on a disclaimer about an optional feature, on
          a page whose whole complaint was that it was hard to take in. */}
      <div className="flex items-center justify-between gap-4">
        <span
          className="flex items-center gap-2 text-[11px] uppercase tracking-wider"
          style={{ color: TOK.textMuted }}
        >
          <Sparkles size={13} />
          {reading ? "In plain English" : "Want this as a paragraph?"}
        </span>
        {!readOnly && (
          <button
            onClick={generate}
            disabled={pending}
            className="text-xs px-3 h-7 rounded-lg transition"
            style={{
              border: `1px solid ${TOK.border}`,
              color: TOK.textSecondary,
              opacity: pending ? 0.6 : 1,
            }}
          >
            {pending ? "Reading…" : reading ? "Regenerate" : "Read the findings"}
          </button>
        )}
      </div>

      {reading ? (
        <div className="flex flex-col gap-4">
          {/* The answer, then the reasoning broken up, then the move. Two
              paragraphs of prose read as a wall and get skimmed to nothing;
              headed points can be scanned first and read second. */}
          <p className="text-[15px] leading-relaxed" style={{ color: TOK.textPrimary }}>
            {reading.answer}
          </p>

          {reading.points && reading.points.length > 0 && (
            <ul className="flex flex-col gap-3">
              {reading.points.map((pt, i) => (
                <li key={`${i}-${pt.heading}`} className="flex gap-3">
                  <span
                    className="text-[11px] font-mono shrink-0 pt-0.5"
                    style={{ color: TOK.textMuted, minWidth: 16 }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[13px] font-medium" style={{ color: TOK.textPrimary }}>
                      {pt.heading}
                    </span>
                    <span
                      className="text-[13px] leading-relaxed"
                      style={{ color: TOK.textSecondary }}
                    >
                      {pt.body}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div
            className="flex flex-col gap-1 rounded-lg px-4 py-3"
            style={{ background: TOK.surfaceElevated }}
          >
            <span
              className="text-[10px] uppercase tracking-wider"
              style={{ color: TOK.textMuted }}
            >
              Where to start
            </span>
            <span className="text-[13px] leading-relaxed" style={{ color: TOK.textPrimary }}>
              {reading.next}
            </span>
          </div>

          {/* Written from the findings below, and only from them. Saying so is
              cheap and it is the difference between a summary and a claim. */}
          <p className="text-[11px]" style={{ color: TOK.textMuted }}>
            Written from the findings on this page — including what could not be
            checked. Nothing here is computed by the model.
          </p>
        </div>
      ) : null}

      {error && (
        <p className="text-xs" style={{ color: TOK.rose }}>
          {error}
        </p>
      )}
    </div>
  );
}
