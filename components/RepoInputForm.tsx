"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Loader2,
} from "lucide-react";
import { parseDeepLinkSubdir } from "@/lib/githubUrl";
import { pollJob } from "@/lib/jobsClient";
import { getOrCreateOwnerId, OWNER_ID_HEADER } from "@/lib/ownerId";
import { TOK } from "@/lib/theme";

/** Parse a GitHub-access error message emitted by lib/github.ts via
 *  the [gh:<code>] wire-format prefix. Used to decide whether to
 *  render an action button (e.g. "Open GitHub settings") next to the
 *  error message — instead of a flat string the user can't act on.
 *  Returns null for non-GitHub errors (timeouts, parse errors, etc.). */
function parseGithubError(
  error: string | null,
): {
  code: "repo-not-found" | "unauthorized" | "rate-limit";
  message: string;
} | null {
  if (!error) return null;
  // No `s` flag — keeps tsconfig target compatibility. Our error
  // messages don't contain newlines (single-line by design), so `.+`
  // captures everything after the prefix without needing dotall.
  const match = error.match(/^\[gh:([^\]]+)\]\s*(.+)$/);
  if (!match) return null;
  const code = match[1];
  if (
    code !== "repo-not-found" &&
    code !== "unauthorized" &&
    code !== "rate-limit"
  ) {
    return null;
  }
  return { code, message: match[2] };
}

// Stage labels + rough durations (ms) used to drive the indeterminate loading UI.
// Real server progress isn't streamed (yet) — we cycle through these as a UX
// scaffold so users don't stare at a blank button for 30 seconds.
const STAGES = [
  { label: "Fetching repo metadata", weight: 2 },
  { label: "Fetching commits & contributors", weight: 4 },
  { label: "Analyzing file changes", weight: 6 },
  { label: "Building dependency graph", weight: 10 },
  { label: "Saving session", weight: 2 },
];
const TOTAL_WEIGHT = STAGES.reduce((a, s) => a + s.weight, 0);
const ESTIMATED_MS = 22_000;

/** Demo-row entry. The language label shows up muted next to the repo path
 *  so users can see at a glance which plugin (JS/TS, Go, Python, Java, …)
 *  the row exercises. Plain string entries are still accepted for callers
 *  that don't care about the label. v0.50: demos no longer rendered inline;
 *  LandingPanel renders them in a dedicated "Try a demo" card next to
 *  "Your sessions". This type stays exported so that card can keep the
 *  same shape. */
export type DemoRepo = string | { repo: string; lang: string };

interface RepoInputFormProps {
  /** Controlled URL value. The form is fully controlled (v0.50) so the
   *  parent landing component can pre-fill it from a "Try a demo"
   *  click in a sibling card. */
  value: string;
  onValueChange: (next: string) => void;
  /** Optional callback fired when the user types into the URL field.
   *  Used by LandingPanel to dismiss the first-visit nudge once any
   *  meaningful interaction happens. */
  onUserInteract?: () => void;
  /** Container surface colour. Defaults to the lifted-card TOK surface used on
   *  the marketing landing; the CodeTrawl workspace passes a bitumen value so
   *  the bar blends into the page instead of standing out. */
  surface?: string;
  /** Container border colour. Defaults to TOK.borderStrong. */
  borderColor?: string;
  /** Drop the elevation shadow + inner highlight (CodeTrawl is hairline, no
   *  box-shadow). Also softens the focus rings to a minimal hairline. */
  flat?: boolean;
  /** Active (ready-to-submit) button background. Defaults to TOK.accent
   *  (emerald); the CodeTrawl workspace passes a neutral bone so the button
   *  isn't a loud green. */
  accent?: string;
  /** Active button text colour, paired with `accent`. */
  accentOn?: string;
}

export function RepoInputForm({
  value,
  onValueChange,
  onUserInteract,
  surface,
  borderColor,
  flat = false,
  accent,
  accentOn,
}: RepoInputFormProps) {
  // Flat (workspace) variant: the focus indicator lives on the CONTAINER
  // (focus-within) so a single minimal hairline ring wraps the whole bar —
  // input AND button — instead of a ring around just the input that cuts off
  // before the button. The default landing keeps its emerald inset ring on
  // the input. Literal strings so Tailwind JITs them.
  const inputFocus = flat
    ? ""
    : "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#10b981]";
  const containerFocus = flat
    ? "focus-within:ring-1 focus-within:ring-inset focus-within:ring-[#5f5a52]"
    : "";
  const buttonFocus = flat
    ? "focus-visible:ring-1 focus-visible:ring-[#5f5a52] focus-visible:ring-offset-1 focus-visible:ring-offset-transparent"
    : "focus-visible:ring-2 focus-visible:ring-[#10b981] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent";
  const [subdir, setSubdir] = useState("");
  const [subdirOpen, setSubdirOpen] = useState(false);
  const [autoFilledFromUrl, setAutoFilledFromUrl] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [stageIdx, setStageIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const router = useRouter();
  const startTime = useRef<number | null>(null);

  // Auto-detect /tree/<branch>/<path> deep-links and lift the path into
  // the subdir field. We open the disclosure too, so the auto-fill is
  // visible (silent fills feel like magic-debug-hell).
  useEffect(() => {
    const detected = parseDeepLinkSubdir(value);
    if (detected && detected !== subdir) {
      setSubdir(detected);
      setSubdirOpen(true);
      setAutoFilledFromUrl(true);
    } else if (!detected && autoFilledFromUrl) {
      // User cleared / changed the URL away from a deep-link — drop the
      // auto-fill so we don't keep stale subdir state. Manual edits keep
      // their value (autoFilledFromUrl flips to false on user input).
      setSubdir("");
      setAutoFilledFromUrl(false);
    }
    // Intentionally don't depend on subdir — that would loop on user edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    if (!pending) {
      startTime.current = null;
      setStageIdx(0);
      setProgress(0);
      return;
    }
    startTime.current = performance.now();
    const tick = () => {
      if (!startTime.current) return;
      const elapsed = performance.now() - startTime.current;
      const ratio = Math.min(0.92, elapsed / ESTIMATED_MS);
      setProgress(ratio);

      let cumul = 0;
      let idx = 0;
      const target = ratio * TOTAL_WEIGHT;
      for (let i = 0; i < STAGES.length; i++) {
        cumul += STAGES[i].weight;
        if (target <= cumul) {
          idx = i;
          break;
        }
        idx = i;
      }
      setStageIdx(idx);
    };
    tick();
    const interval = setInterval(tick, 200);
    return () => clearInterval(interval);
  }, [pending]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!value.trim()) return;

    const trimmedSubdir = subdir.trim();
    startTransition(async () => {
      try {
        // POST returns immediately with a jobId — the actual analysis runs
        // in the background via Next.js's after() hook, so big repos
        // (golang/go, etc.) don't hit Railway's request timeout.
        const ownerId = getOrCreateOwnerId();
        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(ownerId ? { [OWNER_ID_HEADER]: ownerId } : {}),
          },
          body: JSON.stringify({
            repoUrl: value.trim(),
            ...(trimmedSubdir ? { subdir: trimmedSubdir } : {}),
          }),
        });
        let data: {
          error?: string;
          message?: string;
          jobId?: string;
        } | null = null;
        try {
          data = await res.json();
        } catch {
          /* non-JSON response — fall through */
        }
        if (!res.ok) {
          setError(explainServerError(res.status, data));
          return;
        }
        if (!data?.jobId) {
          setError("Server returned no jobId — try again or pick another repo.");
          return;
        }

        // Poll the job until it reaches a terminal state. The fake
        // stage-progress UI keeps animating during this — we don't have
        // real per-stage events from the backend (yet), but the user
        // sees movement instead of a frozen "analyzing..." button.
        const finalJob = await pollJob(data.jobId, () => {
          /* Could surface job.status here for richer UI in the future. */
        });
        if (!finalJob.sessionId) {
          setError("Analysis finished but no session was created. Please try again.");
          return;
        }
        setProgress(1);
        router.push(`/session/${finalJob.sessionId}`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      }
    });
  }

  /** Translate raw server / proxy errors into something a human can act on.
   *  Railway returns 502 + "Application failed to respond" when our backend
   *  exceeds its request timeout — common for very large repos. */
  function explainServerError(
    status: number,
    data: { error?: string; message?: string } | null
  ): string {
    const raw = data?.error || data?.message || "";
    if (
      status === 502 ||
      status === 504 ||
      /failed to respond|timed out|gateway/i.test(raw)
    ) {
      return `Server timed out (HTTP ${status}). This usually means the repo is too large for the current pipeline. Try a smaller repo or a specific subdirectory. Server message: "${raw || "no detail"}"`;
    }
    if (raw) return `${raw} (HTTP ${status})`;
    return `Server error (HTTP ${status})`;
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div
        className={`flex items-center rounded-lg ${containerFocus}`}
        style={{
          // Lifted-card treatment by default (marketing landing): brighter
          // surface + stronger border + elevation shadow. The workspace passes
          // a bitumen `surface` + `flat` so the bar blends into the page.
          background: surface ?? TOK.surfaceElevated,
          border: `1px solid ${borderColor ?? TOK.borderStrong}`,
          boxShadow: flat
            ? "none"
            : "0 1px 0 rgba(255,255,255,0.05) inset, 0 8px 24px -8px rgba(0,0,0,0.5)",
        }}
      >
        <input
          type="text"
          value={value}
          onChange={(e) => {
            onValueChange(e.target.value);
            if (e.target.value.length > 0) onUserInteract?.();
          }}
          placeholder="github.com/owner/repo"
          disabled={pending}
          className={`flex-1 bg-transparent h-12 px-4 text-base rounded-l-lg outline-none ${inputFocus} disabled:opacity-50`}
          style={{ color: TOK.textPrimary }}
        />
        <button
          type="submit"
          disabled={pending || !value.trim()}
          className={`h-10 mr-1 px-4 rounded-md text-sm font-medium transition outline-none ${buttonFocus}`}
          style={{
            background:
              pending || !value.trim()
                ? flat
                  ? "transparent"
                  : TOK.surface
                : (accent ?? TOK.accent),
            color: pending || !value.trim() ? TOK.textSecondary : (accentOn ?? TOK.accentOn),
            // Flat (workspace) variant: no button border, so the bar reads as
            // one continuous outline rather than a box-within-a-box.
            border: `1px solid ${!flat && (pending || !value.trim()) ? TOK.border : "transparent"}`,
          }}
        >
          {pending ? "Analyzing…" : "Analyze →"}
        </button>
      </div>

      {/* Subdir disclosure — collapsed by default to keep first-impression
       *  clean. Auto-opens when a /tree/<branch>/<path> URL is pasted so
       *  the user sees the detected scope. */}
      {!pending && (
        <div className="flex flex-col gap-2 px-1">
          <button
            type="button"
            onClick={() => setSubdirOpen((o) => !o)}
            className="text-xs flex items-center gap-1 self-start transition rounded outline-none focus-visible:ring-2 focus-visible:ring-[#10b981] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
            style={{ color: TOK.textMuted }}
          >
            {subdirOpen ? (
              <ChevronDown size={11} />
            ) : (
              <ChevronRight size={11} />
            )}
            Analyze part of repo only?
            {!subdirOpen && subdir && (
              <span
                className="ml-1 font-mono"
                style={{ color: TOK.accent }}
              >
                · {subdir}
              </span>
            )}
          </button>
          {subdirOpen && (
            <div className="flex flex-col gap-1.5">
              <div
                className="flex items-center rounded-md"
                style={{
                  background: TOK.surface,
                  border: `1px solid ${TOK.border}`,
                }}
              >
                <input
                  type="text"
                  value={subdir}
                  onChange={(e) => {
                    setSubdir(e.target.value);
                    setAutoFilledFromUrl(false);
                  }}
                  placeholder="src/cmd  (optional · case-sensitive · no leading slash)"
                  className="flex-1 bg-transparent h-9 px-3 text-sm rounded-md outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#10b981]"
                  style={{ color: TOK.textPrimary }}
                />
              </div>
              <p
                className="text-[11px] leading-snug"
                style={{ color: TOK.textMuted }}
              >
                {autoFilledFromUrl ? (
                  <>
                    Detected from URL. Clear this field to analyze the whole
                    repo.
                  </>
                ) : (
                  <>
                    Useful for monorepos and very large repos. Root-level
                    manifest files (package.json, go.mod, etc.) are still
                    extracted so dep-health works.
                  </>
                )}
              </p>
            </div>
          )}
        </div>
      )}

      {/* v0.50: demo row removed — moved to LandingPanel's "Try a demo"
       *  card next to "Your sessions". The first-visit nudge ("First
       *  time? Click any of these…") also lives in LandingPanel now. */}

      {error &&
        (() => {
          // GitHub-access errors emitted by lib/github.ts carry a
          // [gh:<code>] prefix. When detected, surface a clean message
          // + an "Open GitHub settings" action so the user can re-
          // authorize or connect their account in one click. Plain
          // errors (timeouts, parse failures, etc.) keep the original
          // single-line treatment. v0.81+.
          const gh = parseGithubError(error);
          if (!gh) {
            return (
              <p className="text-sm px-1" style={{ color: TOK.rose }}>
                {error}
              </p>
            );
          }
          const actionable =
            gh.code === "repo-not-found" || gh.code === "unauthorized";
          return (
            <div
              className="flex flex-col gap-2 px-3 py-2.5 rounded-md text-sm"
              style={{
                background: `${TOK.rose}0d`,
                border: `1px solid ${TOK.rose}33`,
                color: TOK.rose,
              }}
            >
              <span>{gh.message}</span>
              {actionable && (
                <Link
                  href="/account/connections"
                  className="inline-flex items-center gap-1 text-xs font-medium w-fit hover:underline transition"
                  style={{ color: TOK.rose }}
                >
                  Open GitHub settings
                  <ArrowUpRight size={12} />
                </Link>
              )}
            </div>
          );
        })()}

      {pending && (
        <div className="flex flex-col gap-2 mt-1 px-1">
          <div className="flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="h-2 w-2 rounded-full animate-pulse shrink-0"
                style={{ background: TOK.accent }}
                aria-hidden
              />
              <span
                className="font-medium truncate"
                style={{ color: TOK.textPrimary }}
              >
                {STAGES[stageIdx].label}…
              </span>
            </div>
            <span
              className="tabular-nums shrink-0"
              style={{ color: TOK.textSecondary }}
            >
              {Math.round(progress * 100)}%
            </span>
          </div>
          <div
            className="h-1.5 w-full rounded-full overflow-hidden"
            style={{ background: TOK.surface }}
          >
            <div
              className="h-full transition-[width] duration-200 ease-linear"
              style={{
                width: `${progress * 100}%`,
                background: `linear-gradient(90deg, ${TOK.accent}, #34d399)`,
              }}
            />
          </div>
          <ol className="flex flex-wrap gap-1.5 text-[10px] font-mono">
            {STAGES.map((s, i) => {
              const done = i < stageIdx;
              const active = i === stageIdx;
              return (
                <li
                  key={s.label}
                  className="px-2 py-0.5 rounded-full border"
                  style={{
                    borderColor: done
                      ? `${TOK.accent}66`
                      : active
                      ? TOK.border
                      : "rgba(255,255,255,0.05)",
                    background: done
                      ? TOK.accentSoft
                      : active
                      ? TOK.surface
                      : "transparent",
                    color: done
                      ? TOK.accent
                      : active
                      ? TOK.textPrimary
                      : TOK.textMuted,
                  }}
                >
                  <span className="inline-flex items-center justify-center w-3 h-3">
                    {done ? (
                      <Check size={11} />
                    ) : active ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Circle size={9} />
                    )}
                  </span>{" "}
                  {s.label}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </form>
  );
}
