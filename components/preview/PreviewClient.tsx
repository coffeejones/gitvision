"use client";

// Change-blast preview client island (Arc 5, beat 1). Paste a PR URL → POST
// /api/preview → poll the job → fetch + render the ChangeBlastReport. Lives
// inside the /preview marketing shell (server component provides CTSurface).

import { useCallback, useEffect, useRef, useState } from "react";
import { Share2, Link2, Check } from "lucide-react";
import type { StoredPreview } from "@/lib/previewStore";
import { BlastCardModal } from "./BlastCardModal";
import {
  ORANGE,
  BONE,
  MUTED,
  SURFACE,
  BORDER,
  VERDICT,
  KIND_LABEL,
  TIER_COLOR,
} from "./previewTheme";

type Phase = "idle" | "running" | "done" | "error";

/** Strip the `[gh:<code>]` wire prefix a GithubAccessError carries, leaving the
 *  human sentence. Non-gh errors pass through untouched. */
function humanize(s: unknown): string {
  if (typeof s !== "string") return "";
  return s.match(/^\[gh:[^\]]+\]\s*(.+)$/)?.[1] ?? s;
}

export function PreviewClient() {
  const [prUrl, setPrUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<StoredPreview | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The job the current poll loop belongs to. A new submit bumps this so a
  // stale in-flight loop (from a previous submit) sees the mismatch and bails.
  const activeJob = useRef<string | null>(null);

  // Clear any pending poll timer on unmount so we don't setState on a gone
  // component (React warning + wasted fetch).
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Deep link: /preview?preview=<id> loads a past result directly (a preview is
  // shareable — the id is the only handle).
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("preview");
    if (!id) return;
    setPhase("running");
    fetch(`/api/previews/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Preview not found."))))
      .then((p) => {
        setPreview(p);
        setPhase("done");
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Preview not found.");
        setPhase("error");
      });
  }, []);

  const poll = useCallback(async (jobId: string) => {
    // A newer submit superseded this loop — stop silently.
    if (activeJob.current !== jobId) return;
    try {
      const res = await fetch(`/api/jobs/${jobId}`);
      // GET /api/jobs/[id] returns a { job } envelope, not the bare record.
      const { job } = await res.json();
      if (!res.ok || !job) {
        setError(humanize(job?.error) || "The analysis failed.");
        setPhase("error");
        return;
      }
      if (activeJob.current !== jobId) return;
      if (job.status === "failed") {
        setError(humanize(job.error) || "The analysis failed.");
        setPhase("error");
        return;
      }
      if (job.status === "done" && job.previewId) {
        const pRes = await fetch(`/api/previews/${job.previewId}`);
        if (!pRes.ok) throw new Error("Preview not found.");
        if (activeJob.current !== jobId) return;
        setPreview(await pRes.json());
        setPhase("done");
        return;
      }
      timer.current = setTimeout(() => poll(jobId), 3000);
    } catch (e) {
      if (activeJob.current !== jobId) return;
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setPhase("error");
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (timer.current) clearTimeout(timer.current);
    setError(null);
    setPreview(null);
    setPhase("running");
    try {
      const res = await fetch("/api/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(humanize(data.error) || "Could not start the preview.");
        setPhase("error");
        return;
      }
      activeJob.current = data.jobId;
      poll(data.jobId);
    } catch {
      setError("Could not reach the server.");
      setPhase("error");
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: "48px auto 0" }}>
      <form onSubmit={submit} style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          value={prUrl}
          onChange={(e) => setPrUrl(e.target.value)}
          placeholder="https://github.com/owner/repo/pull/123"
          spellCheck={false}
          style={{
            flex: "1 1 320px",
            height: 44,
            padding: "0 14px",
            borderRadius: 10,
            background: "rgba(0,0,0,0.3)",
            border: `1px solid ${BORDER}`,
            color: BONE,
            fontSize: 14.5,
            fontFamily: "inherit",
          }}
        />
        <button
          type="submit"
          disabled={phase === "running" || !prUrl.trim()}
          className="ct-btn"
          style={{ height: 44, opacity: phase === "running" || !prUrl.trim() ? 0.5 : 1 }}
        >
          {phase === "running" ? "Analyzing…" : "Preview the blast"}
        </button>
      </form>

      {phase === "running" && (
        <p style={{ marginTop: 20, fontSize: 14, color: MUTED, lineHeight: 1.6 }}>
          Analyzing the base and head refs — this runs two full sweeps, so it
          takes a minute or two on a big repo. The base branch is cached, so a
          second PR against the same branch is much faster.
        </p>
      )}

      {phase === "error" && (
        <p style={{ marginTop: 20, fontSize: 14, color: ORANGE, lineHeight: 1.6 }}>
          {error}
        </p>
      )}

      {phase === "done" && preview && <Result preview={preview} />}
    </div>
  );
}

const FILE_ROW_CAP = 100;

function Result({ preview }: { preview: StoredPreview }) {
  const { report, pr } = preview;
  const v = VERDICT[report.verdict];
  const shownFiles = report.changedFiles.slice(0, FILE_ROW_CAP);
  const hiddenFiles = report.changedFiles.length - shownFiles.length;
  const [blastOpen, setBlastOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyLink = useCallback(async () => {
    try {
      const url = `${window.location.origin}/preview?preview=${preview.id}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (insecure context / iframe) — surface the URL so the
      // user can copy it by hand.
      window.prompt(
        "Copy this preview link:",
        `${window.location.origin}/preview?preview=${preview.id}`,
      );
    }
  }, [preview.id]);

  if (!report.hasGraphs) {
    return (
      <p style={{ marginTop: 24, fontSize: 14, color: MUTED, lineHeight: 1.6 }}>
        One of the refs couldn&rsquo;t be code-analyzed (unsupported languages or
        an empty diff), so the blast can&rsquo;t be mapped. {report.headline}
      </p>
    );
  }

  return (
    <div style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Reviewer brief card */}
      <div
        style={{
          background: SURFACE,
          border: `1px solid ${v.color}55`,
          borderRadius: 14,
          padding: "20px 22px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: v.color,
              background: `${v.color}1a`,
              border: `1px solid ${v.color}55`,
              borderRadius: 8,
              padding: "4px 12px",
            }}
          >
            {v.label}
          </span>
          <span style={{ fontSize: 13, color: MUTED }}>
            {pr.owner}/{pr.repo} #{pr.number} · {pr.baseRef} ← {pr.headRef}
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <ActionButton onClick={() => setBlastOpen(true)}>
              <Share2 size={13} /> Share card
            </ActionButton>
            <ActionButton onClick={copyLink}>
              {copied ? <Check size={13} /> : <Link2 size={13} />}
              {copied ? "Copied" : "Copy link"}
            </ActionButton>
          </div>
        </div>
        <p style={{ fontSize: 16.5, color: BONE, fontWeight: 600, letterSpacing: "-0.01em", margin: 0 }}>
          {report.headline}
        </p>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 13, color: MUTED }}>
          <Stat n={report.changedFiles.length} one="file changed" many="files changed" />
          <Stat
            n={report.loadBearingTouched.length}
            one="load-bearing wall"
            many="load-bearing walls"
            accent={report.loadBearingTouched.length > 0 ? ORANGE : undefined}
          />
          <Stat n={report.combinedDependents} one="dependent reached" many="dependents reached" />
          <Stat n={report.testFilesChanged} one="test file in diff" many="test files in diff" />
        </div>
      </div>

      {/* Changed files */}
      <div style={{ display: "flex", flexDirection: "column", borderRadius: 12, overflow: "hidden", border: `1px solid ${BORDER}` }}>
        {shownFiles.map((f, i) => (
          <div
            key={f.file}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 12,
              padding: "12px 16px",
              background: i % 2 === 0 ? SURFACE : "transparent",
              borderTop: i === 0 ? "none" : `1px solid ${BORDER}`,
              alignItems: "center",
            }}
          >
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontFamily: "var(--font-ct-mono, monospace)", fontSize: 13, color: BONE, wordBreak: "break-all" }}>
                {f.file}
              </span>
              <span style={{ fontSize: 11.5, color: MUTED }}>
                {KIND_LABEL[f.kind]}
                {!f.isTest && (
                  <>
                    {" · "}
                    <span style={{ color: TIER_COLOR[f.tier] ?? MUTED }}>{f.tier}</span>
                    {" · "}
                    {f.dependents} dependent{f.dependents === 1 ? "" : "s"}
                    {f.untestedDependents > 0 && ` (${f.untestedDependents} untested)`}
                  </>
                )}
                {f.isTest && " · test"}
              </span>
            </div>
            {!f.isTest && f.testsToRun.length > 0 && (
              <span style={{ fontSize: 11.5, color: MUTED, textAlign: "right", whiteSpace: "nowrap" }}>
                {f.testsToRun.length} test{f.testsToRun.length === 1 ? "" : "s"} to run
              </span>
            )}
          </div>
        ))}
        {hiddenFiles > 0 && (
          <div
            style={{
              padding: "12px 16px",
              fontSize: 12,
              color: MUTED,
              borderTop: `1px solid ${BORDER}`,
              background: "transparent",
            }}
          >
            + {hiddenFiles} more changed file{hiddenFiles === 1 ? "" : "s"} (ranked below the
            top {FILE_ROW_CAP})
          </div>
        )}
      </div>

      <p style={{ fontSize: 11.5, color: "rgba(255,255,255,0.42)", lineHeight: 1.6 }}>
        Pre-planning context — the diff mapped onto the repo-at-head code graph,
        deterministic, cited to imports + calls. Not a line-by-line review; it
        shows what a change <em>reaches</em>, not whether it&rsquo;s correct.
      </p>

      <BlastCardModal
        pr={pr}
        report={report}
        open={blastOpen}
        onClose={() => setBlastOpen(false)}
      />
    </div>
  );
}

function ActionButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 30,
        padding: "0 12px",
        borderRadius: 8,
        background: "rgba(255,255,255,0.05)",
        border: `1px solid ${BORDER}`,
        color: BONE,
        fontSize: 12.5,
        fontFamily: "inherit",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function Stat({
  n,
  one,
  many,
  accent,
}: {
  n: number;
  one: string;
  many: string;
  accent?: string;
}) {
  return (
    <span>
      <strong style={{ color: accent ?? BONE, fontFamily: "var(--font-ct-mono, monospace)" }}>{n}</strong>{" "}
      {n === 1 ? one : many}
    </span>
  );
}
