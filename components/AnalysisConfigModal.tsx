"use client";

// Pre-analysis config box. Opens when the user submits a repo in the
// workspace input instead of running immediately: pick a branch + an optional
// subdir, then Run. This makes the branch part of the analysis's identity, so
// the same repo can have several sessions — one per branch — chosen up front.
//
// Self-contained dark styling (bitumen + bone) so it renders consistently
// regardless of the host theme. Branches come from GET /api/github/branches,
// which also validates the repo exists / is accessible before a full sweep.

import { useEffect, useState } from "react";
import { Loader2, X, GitBranch, ArrowRight, AlertCircle } from "lucide-react";

interface BranchesResponse {
  defaultBranch?: string;
  branches?: string[];
  truncated?: boolean;
  error?: string;
}

const BONE = "#f2efea";
const MUTED = "rgba(242,239,234,0.62)";
const HAIR = "rgba(242,239,234,0.14)";
const FIELD_BG = "#0f0e0c";

export function AnalysisConfigModal({
  repo,
  initialSubdir = "",
  onRun,
  onClose,
}: {
  /** owner/repo, shown in the header and used to fetch branches. */
  repo: string;
  initialSubdir?: string;
  /** ref is null when the default branch is chosen (keeps "default = no
   *  explicit ref" semantics); otherwise the branch name. */
  onRun: (ref: string | null, subdir: string) => void;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [defaultBranch, setDefaultBranch] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [branch, setBranch] = useState("");
  const [subdir, setSubdir] = useState(initialSubdir);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/github/branches?repo=${encodeURIComponent(repo)}`,
        );
        const data = (await res.json().catch(() => ({}))) as BranchesResponse;
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "Couldn't load branches.");
          return;
        }
        const list = data.branches ?? [];
        setBranches(list);
        setDefaultBranch(data.defaultBranch ?? null);
        setTruncated(!!data.truncated);
        setBranch(data.defaultBranch ?? list[0] ?? "");
      } catch {
        if (!cancelled) setError("Network error loading branches.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  function run() {
    const ref = branch && branch !== defaultBranch ? branch : null;
    onRun(ref, subdir.trim());
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Configure analysis"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "rgba(0,0,0,0.6)",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 460,
          background: "#15140f",
          border: `1px solid ${HAIR}`,
          borderRadius: 14,
          boxShadow: "0 20px 60px -20px rgba(0,0,0,0.8)",
          color: BONE,
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "16px 18px",
            borderBottom: `1px solid ${HAIR}`,
          }}
        >
          <GitBranch size={16} style={{ color: MUTED, flexShrink: 0 }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Configure sweep</div>
            <div
              style={{
                fontSize: 12.5,
                color: MUTED,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {repo}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cancel"
            style={{
              background: "transparent",
              border: "none",
              color: MUTED,
              cursor: "pointer",
              padding: 4,
              lineHeight: 0,
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Branch */}
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 500 }}>Branch</span>
            {loading ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  height: 40,
                  padding: "0 12px",
                  borderRadius: 8,
                  border: `1px solid ${HAIR}`,
                  background: FIELD_BG,
                  color: MUTED,
                  fontSize: 13.5,
                }}
              >
                <Loader2 size={14} className="animate-spin" /> Loading branches…
              </span>
            ) : (
              <select
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                disabled={branches.length === 0}
                style={{
                  height: 40,
                  padding: "0 12px",
                  borderRadius: 8,
                  border: `1px solid ${HAIR}`,
                  background: FIELD_BG,
                  color: BONE,
                  fontSize: 13.5,
                  appearance: "none",
                  cursor: branches.length === 0 ? "default" : "pointer",
                }}
              >
                {branches.length === 0 && <option value="">default branch</option>}
                {branches.map((b) => (
                  <option key={b} value={b} style={{ background: FIELD_BG }}>
                    {b}
                    {b === defaultBranch ? "  · default" : ""}
                  </option>
                ))}
              </select>
            )}
            {truncated && (
              <span style={{ fontSize: 11.5, color: MUTED }}>
                Showing the first 300 branches.
              </span>
            )}
            {error && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  color: "#ff8a50",
                }}
              >
                <AlertCircle size={13} /> {error}
              </span>
            )}
          </label>

          {/* Subdir */}
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 500 }}>
              Subdirectory{" "}
              <span style={{ color: MUTED, fontWeight: 400 }}>(optional)</span>
            </span>
            <input
              type="text"
              value={subdir}
              onChange={(e) => setSubdir(e.target.value)}
              placeholder="src/cmd — leave blank for the whole repo"
              style={{
                height: 40,
                padding: "0 12px",
                borderRadius: 8,
                border: `1px solid ${HAIR}`,
                background: FIELD_BG,
                color: BONE,
                fontSize: 13.5,
                outline: "none",
              }}
            />
          </label>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
            padding: "14px 18px",
            borderTop: `1px solid ${HAIR}`,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              color: BONE,
              border: `1px solid ${HAIR}`,
              borderRadius: 8,
              padding: "9px 16px",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={run}
            disabled={loading}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              background: BONE,
              color: "#0c0b0a",
              border: "none",
              borderRadius: 8,
              padding: "9px 18px",
              fontSize: 13,
              fontWeight: 600,
              cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.5 : 1,
            }}
          >
            Run sweep
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
