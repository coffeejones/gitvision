"use client";

// Three-column health verdict: what works, where to dig deeper, open questions.
// Evidence is visible by default (no more hidden <details>) — each column
// shows the narrative prose on top and a signal bullet list below it.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCw, Stethoscope } from "lucide-react";
import type { AnalysisSnapshot, HealthSignal } from "@/lib/types";
import { TOK } from "@/lib/theme";

/** The three anchor IDs the HealthSummary tiles deep-link to. Kept
 *  exhaustive (not extended) so a typo in a tile's anchor never lights
 *  up the wrong column — only members of this list flash. */
const ANCHOR_IDS = [
  "health-working",
  "health-needs-work",
  "health-questions",
] as const;

/** Watch window.location.hash for an anchor match on mount + on
 *  hashchange. When the hash points at one of our columns, add the
 *  .anchor-flash-active class — the CSS keyframe pulses a faint amber
 *  ring continuously while the class is present. The class persists
 *  for the lifetime of the page (no auto-removal) so the pulse acts
 *  as a "you are here" marker until the user navigates away.
 *
 *  When the user clicks a different HealthSummary tile (hash change
 *  to a different anchor), we move the class off the previous column
 *  and onto the new one. Cleanup removes it on unmount.
 *
 *  Timing note: Next.js App Router's <Link> sets the URL hash
 *  asynchronously after the new route's components mount, so reading
 *  window.location.hash synchronously on first effect-run misses it.
 *  We poll a few rAF ticks to catch the hash once it lands. After
 *  that the hashchange listener handles in-page navigations. */
function useAnchorFlash() {
  useEffect(() => {
    let cancelled = false;
    let activeEl: HTMLElement | null = null;

    function applyFlash(hash: string) {
      if (!ANCHOR_IDS.includes(hash as (typeof ANCHOR_IDS)[number])) return;
      const el = document.getElementById(hash);
      if (!el || el === activeEl) return;
      // Move the pulse class from the previously-active column (if
      // any) to the new target so only one column pulses at a time.
      if (activeEl) activeEl.classList.remove("anchor-flash-active");
      el.classList.add("anchor-flash-active");
      activeEl = el;
    }

    function flashFromCurrentHash() {
      const hash = window.location.hash.replace(/^#/, "");
      if (hash) applyFlash(hash);
    }

    // Initial mount: poll up to ~10 frames for the hash to land. Stops
    // as soon as we see a non-empty hash, or after the budget is spent.
    let attempts = 0;
    function pollForHash() {
      if (cancelled) return;
      const hash = window.location.hash.replace(/^#/, "");
      if (hash) {
        applyFlash(hash);
        return;
      }
      if (attempts++ < 10) {
        requestAnimationFrame(pollForHash);
      }
    }
    requestAnimationFrame(pollForHash);

    // Subsequent in-page hash changes (clicking another tile while on
    // /insights) — the browser fires hashchange synchronously here.
    window.addEventListener("hashchange", flashFromCurrentHash);
    return () => {
      cancelled = true;
      // Stop the pulse so it doesn't linger if the column happens to
      // stay in DOM after this component unmounts.
      if (activeEl) activeEl.classList.remove("anchor-flash-active");
      window.removeEventListener("hashchange", flashFromCurrentHash);
    };
  }, []);
}

interface Props {
  sessionId: string;
  snapshot: AnalysisSnapshot;
}

export function HealthPanel({ sessionId, snapshot }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const analysis = snapshot.healthAnalysis;
  // Pulse the deep-linked column on hash navigation. Lives at panel
  // level (not per-column) so we only register one effect.
  useAnchorFlash();

  function generate() {
    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch(`/api/sessions/${sessionId}/health`, {
          method: "POST",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (res.status === 501) {
            setError(
              "ANTHROPIC_API_KEY is not set. Add it to .env.local (or Railway env) and redeploy."
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
      aria-label="Repository health check"
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
            Health check
          </h2>
          {analysis && (
            <span
              className="text-[11px] font-mono tabular-nums"
              style={{ color: TOK.textMuted }}
            >
              · {analysis.model} ·{" "}
              {new Date(analysis.generatedAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          )}
        </div>
        <button
          onClick={generate}
          disabled={pending}
          className="text-xs transition disabled:opacity-40 flex items-center gap-1.5"
          style={{ color: analysis ? TOK.textSecondary : TOK.accent }}
        >
          {pending ? (
            <>
              <span
                className="h-1.5 w-1.5 rounded-full animate-pulse"
                style={{ background: TOK.accent }}
              />
              <span>Analyzing…</span>
            </>
          ) : analysis ? (
            <>
              <RotateCw size={12} />
              <span>Regenerate</span>
            </>
          ) : (
            <>
              <Stethoscope size={12} />
              <span>Run health check</span>
            </>
          )}
        </button>
      </div>

      {!analysis && !pending && (
        <p className="text-xs" style={{ color: TOK.textMuted }}>
          Claude reads the 20 signals already computed for the Overview strip
          and writes a verdict you can act on — what works, where to dig
          deeper, and what needs human judgment.
        </p>
      )}

      {analysis && (
        <div className="grid md:grid-cols-3 gap-3">
          <HealthColumn
            anchorId="health-working"
            label="What works"
            accent={TOK.accent}
            narrative={analysis.narrative.working}
            signals={analysis.signals.working}
          />
          <HealthColumn
            anchorId="health-needs-work"
            label="Where to dig deeper"
            accent={TOK.amber}
            narrative={analysis.narrative.needsWork}
            signals={analysis.signals.needsWork}
          />
          <HealthColumn
            anchorId="health-questions"
            label="Open questions"
            accent={TOK.textSecondary}
            narrative={analysis.narrative.questions}
            signals={analysis.signals.questions}
          />
        </div>
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

function HealthColumn({
  anchorId,
  label,
  accent,
  narrative,
  signals,
}: {
  /** Fragment id (e.g. "health-working") so deep-links from the
   *  Overview's HealthSummary tiles can scroll to this column. The
   *  scroll-margin-top keeps the anchor below the sticky workspace
   *  toolbar when it lands. */
  anchorId: string;
  label: string;
  accent: string;
  narrative: string;
  signals: HealthSignal[];
}) {
  return (
    <div
      id={anchorId}
      // Material card recipe — diagonal gradient + 1px ambient shadow,
      // matches the AI briefing + Packages tiles. The accent-tinted bar
      // above the heading is now a subtle 2px top border instead of an
      // inline pill, so each column reads as "section with severity-
      // hinted edge" rather than "card with a colored label sticker".
      className="rounded-xl p-5 flex flex-col gap-3 relative overflow-hidden"
      style={{
        background: `linear-gradient(135deg, ${TOK.surfaceElevated} 0%, ${TOK.surface} 60%)`,
        border: `1px solid ${TOK.border}`,
        boxShadow:
          "0 1px 2px rgba(0, 0, 0, 0.15), 0 8px 24px -12px rgba(0, 0, 0, 0.35)",
        scrollMarginTop: "5rem",
      }}
    >
      <span
        className="absolute top-0 left-5 right-5 h-px"
        style={{ background: accent }}
      />
      <h3
        className="text-base font-semibold tracking-tight"
        style={{
          color: TOK.textPrimary,
          letterSpacing: "-0.01em",
        }}
      >
        {label}
      </h3>

      <p
        className="text-[13px] leading-relaxed"
        style={{ color: TOK.textPrimary }}
      >
        {narrative || "—"}
      </p>

      {signals.length > 0 && (
        <div
          className="flex flex-col gap-1.5 pt-3 border-t"
          style={{ borderColor: TOK.border }}
        >
          {signals.map((s) => (
            <div key={s.id} className="flex items-start gap-2">
              <span
                className="h-1 w-1 rounded-full shrink-0 mt-1.5"
                style={{ background: accent }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span
                    className="text-xs font-medium"
                    style={{ color: TOK.textPrimary }}
                  >
                    {s.title}
                  </span>
                  {s.severity && (
                    <span
                      className="text-[9px] uppercase tracking-wider px-1 py-px rounded"
                      style={{
                        background:
                          s.severity === "high" ? TOK.roseSoft : TOK.amberSoft,
                        color: s.severity === "high" ? TOK.rose : TOK.amber,
                      }}
                    >
                      {s.severity}
                    </span>
                  )}
                </div>
                <div
                  className="text-[11px] mt-0.5"
                  style={{ color: TOK.textMuted }}
                >
                  {s.detail}
                </div>
                {s.evidence.paths && s.evidence.paths.length > 0 && (
                  <div
                    className="font-mono text-[10px] mt-1 break-all"
                    style={{ color: TOK.textMuted }}
                  >
                    {s.evidence.paths.slice(0, 3).join(" · ")}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
