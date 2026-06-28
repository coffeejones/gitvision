"use client";

// "Refine scope" — the in-session control for exclude-folders (UX B). The
// initial analysis is whole-repo (keeps the paste-a-URL hero clean); this lets
// the owner drop generated/vendored/test folders AFTER seeing the first result
// and re-sweep, so the analysis points only at the real code. Posts the new
// exclusion set to the refresh endpoint (which stores it on the new snapshot
// and re-applies it on future refreshes).

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal, RefreshCw, X } from "lucide-react";
import { pollJob } from "@/lib/jobsClient";
import { getOrCreateOwnerId, OWNER_ID_HEADER } from "@/lib/ownerId";
import { TOK } from "@/lib/sessionTheme";

// Common noise folders the auto-skip list doesn't already cover, offered as
// one-tap chips. The user can also type any folder name or path prefix.
const SUGGESTIONS = [
  "tests",
  "test",
  "examples",
  "docs",
  "fixtures",
  "benchmarks",
];

function parseFolders(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\n,]/)) {
    const t = part.trim().replace(/^\/+|\/+$/g, "");
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

export function RefineScope({
  sessionId,
  current,
}: {
  sessionId: string;
  current?: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState((current ?? []).join(", "));
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  function addChip(s: string) {
    const cur = parseFolders(value);
    if (!cur.includes(s)) setValue([...cur, s].join(", "));
  }

  function apply() {
    if (pending) return;
    startTransition(async () => {
      setMessage(null);
      try {
        const ownerId = getOrCreateOwnerId();
        const res = await fetch(`/api/sessions/${sessionId}/refresh`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(ownerId ? { [OWNER_ID_HEADER]: ownerId } : {}),
          },
          body: JSON.stringify({ excludeFolders: parseFolders(value) }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setMessage(data.error || `Re-sweep failed (HTTP ${res.status})`);
          return;
        }
        if (!data.jobId) {
          setMessage("Re-sweep enqueued but no job id returned.");
          return;
        }
        await pollJob(data.jobId, () => {});
        setOpen(false);
        router.refresh();
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Re-sweep failed");
      }
    });
  }

  const activeCount = current?.length ?? 0;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Refine scope — exclude folders (tests, generated, vendored) and re-sweep"
        className="h-8 px-3 rounded-md text-xs transition flex items-center gap-1.5 hover:bg-white/5"
        style={{
          color: activeCount ? TOK.accent : TOK.textSecondary,
          border: `1px solid ${activeCount ? TOK.accent : "rgba(255,255,255,0.1)"}`,
        }}
      >
        <SlidersHorizontal size={13} />
        <span>{activeCount ? `Scope (${activeCount})` : "Scope"}</span>
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-80 rounded-lg p-4 z-50 flex flex-col gap-3 shadow-xl"
          style={{
            background: TOK.surfaceElevated,
            border: `1px solid ${TOK.border}`,
          }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-col gap-0.5">
              <span
                className="text-[11px] uppercase tracking-[0.14em] font-medium"
                style={{ color: TOK.textMuted }}
              >
                Refine scope
              </span>
              <p className="text-[12px] leading-snug" style={{ color: TOK.textSecondary }}>
                Exclude folders, then re-sweep so the analysis points only at
                the real code.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="opacity-60 hover:opacity-100"
              aria-label="Close"
            >
              <X size={14} style={{ color: TOK.textMuted }} />
            </button>
          </div>

          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={2}
            placeholder="tests, examples, packages/legacy"
            className="w-full rounded-md px-2.5 py-2 text-[13px] resize-none outline-none"
            style={{
              background: TOK.surface,
              border: `1px solid ${TOK.border}`,
              color: TOK.textPrimary,
              fontFamily: "var(--font-mono)",
            }}
          />

          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => addChip(s)}
                className="text-[11px] px-2 py-0.5 rounded transition hover:opacity-80"
                style={{
                  background: TOK.surface,
                  border: `1px solid ${TOK.border}`,
                  color: TOK.textMuted,
                  fontFamily: "var(--font-mono)",
                }}
              >
                +{s}
              </button>
            ))}
          </div>

          {message && (
            <p className="text-[12px]" style={{ color: TOK.rose }}>
              {message}
            </p>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-[11px]" style={{ color: TOK.textMuted }}>
              A name (e.g. tests) drops that folder anywhere; a path
              (packages/x) drops that subtree.
            </span>
            <button
              type="button"
              onClick={apply}
              disabled={pending}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium transition hover:opacity-90 disabled:opacity-50 shrink-0"
              style={{ background: TOK.accent, color: TOK.accentOn }}
            >
              <RefreshCw
                size={12}
                className={pending ? "animate-spin" : ""}
              />
              {pending ? "Re-sweeping…" : "Apply & re-sweep"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
