"use client";

// Claude-generated repo briefing. Lazy — nothing happens until the user clicks
// "Run". The server stores the result on the latest snapshot so subsequent
// loads render instantly (no re-spend).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCw, Sparkles } from "lucide-react";
import type { AnalysisSnapshot } from "@/lib/types";
import { TOK } from "@/lib/sessionTheme";

interface Props {
  sessionId: string;
  snapshot: AnalysisSnapshot;
  /** Read-only display: show the cached briefing but no generate /
   *  regenerate control. Used on the public demo sessions, whose AI output is
   *  pre-baked and whose anonymous viewers can't (and shouldn't) generate. */
  readOnly?: boolean;
}

export function AiSummaryPanel({
  sessionId,
  snapshot,
  readOnly = false,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const summary = snapshot.aiSummary;

  // Read-only with nothing baked yet — render nothing rather than an empty
  // shell or a control the viewer can't use.
  if (readOnly && !summary) return null;

  function generate() {
    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch(`/api/sessions/${sessionId}/summary`, {
          method: "POST",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (res.status === 501) {
            setError(
              "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the dev server."
            );
          } else {
            setError(body.error ?? `Request failed (${res.status})`);
          }
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      }
    });
  }

  return (
    <section
      className="flex flex-col gap-3"
      aria-label="AI repository briefing"
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-2">
          <h2
            className="text-lg font-semibold tracking-tight"
            style={{
              color: TOK.textPrimary,
              letterSpacing: "-0.015em",
            }}
          >
            AI briefing
          </h2>
          {summary && (
            <span
              className="text-[11px] font-mono tabular-nums"
              style={{ color: TOK.textMuted }}
            >
              · {summary.model} ·{" "}
              {new Date(summary.generatedAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          )}
        </div>
        {!readOnly && (
          <button
            onClick={generate}
            disabled={pending}
            className="text-xs transition disabled:opacity-40 flex items-center gap-1.5"
            style={{ color: summary ? TOK.textSecondary : TOK.accent }}
          >
            {pending ? (
              <>
                <span
                  className="h-1.5 w-1.5 rounded-full animate-pulse"
                  style={{ background: TOK.accent }}
                />
                <span>Thinking…</span>
              </>
            ) : summary ? (
              <>
                <RotateCw size={12} />
                <span>Regenerate</span>
              </>
            ) : (
              <>
                <Sparkles size={12} />
                <span>Run briefing</span>
              </>
            )}
          </button>
        )}
      </div>

      {!readOnly && !summary && !pending && (
        <p className="text-xs" style={{ color: TOK.textMuted }}>
          Claude writes a 150-word profile — what the project is, how it&apos;s
          built, and what&apos;s happening lately. Cached per snapshot.
        </p>
      )}

      {summary && (
        <article
          // Material card — same diagonal gradient + layered shadow
          // recipe as the WorkspaceCard / featured-finding hero on
          // landing. Makes the AI briefing read as "a printed page"
          // rather than "a flat colored rectangle".
          className="rounded-xl p-6 flex flex-col gap-3"
          style={{
            background: TOK.surface,
            border: `1px solid ${TOK.border}`,
          }}
        >
          <div
            className="text-[15px] leading-relaxed whitespace-pre-wrap"
            style={{ color: TOK.textPrimary }}
          >
            {summary.text}
          </div>
        </article>
      )}

      {error && (
        <div
          className="text-sm rounded-md p-3"
          style={{
            color: TOK.rose,
            background: TOK.roseSoft,
            border: `1px solid ${TOK.rose}44`,
          }}
        >
          {error}
        </div>
      )}
    </section>
  );
}
