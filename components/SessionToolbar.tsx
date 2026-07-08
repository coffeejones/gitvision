"use client";

// Session topbar — slim workspace bar (v0.43+).
//
// Sits above the SessionShell sidebar+main area. Full width, 48px tall,
// only contains identity + primary actions:
//   - Repo path + snapshot age (left)
//   - Refresh (accent button)
//   - Share dropdown (Wrapped / Share card / Screenshot)
//   - Overflow menu (Delete)
//
// What used to be here but moved out:
//   - "← All sessions" link → SessionShell sidebar (dedup)
//   - Session name editor → Overview hero (only editable from one place)
//   - "Snapshot N of N" verbose phrasing → compact "N snapshots · 1d ago"
//
// Rename is still triggered by clicking the session name on the
// Overview page (SessionNameEditor). Keeping it there means the
// rename action is always co-located with the visible name; adding
// it to the topbar would split the affordance.

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import * as htmlToImage from "html-to-image";
import Link from "next/link";
import {
  Award,
  Camera,
  ChevronDown,
  GitBranch,
  Gift,
  HelpCircle,
  MessageSquarePlus,
  MoreHorizontal,
  RefreshCw,
  Share2,
  ShieldAlert,
  Sparkles,
  Trash2,
  TrendingUp,
} from "lucide-react";
import type { AnalysisSnapshot } from "@/lib/types";
import { pollJob } from "@/lib/jobsClient";
import { getOrCreateOwnerId, OWNER_ID_HEADER } from "@/lib/ownerId";
import { TOK } from "@/lib/sessionTheme";
import { WatchToggle } from "@/components/WatchToggle";
import { RefineScope } from "@/components/RefineScope";
import { ShareCardModal } from "./ShareCardModal";
import { WallCardModal } from "./WallCardModal";
import { DriftCardModal } from "./DriftCardModal";
import { BadgeModal } from "./BadgeModal";
import { ContributorWrappedModal } from "./ContributorWrappedModal";
import type { DriftReport } from "@/lib/driftMetrics";
import { FeedbackModal } from "./FeedbackModal";
import { Logo } from "./Logo";

interface Props {
  sessionId: string;
  sessionName: string;
  snapshot: AnalysisSnapshot;
  targetId: string;
  // Delivered from the parent session page so we know what to show in the top strip
  updatedAtISO: string;
  snapshotCount: number;
  // Multi-sweep drift report (Arc 3) — computed server-side in the layout since
  // it spans every snapshot's fingerprint; feeds the drift share card.
  driftReport: DriftReport;
}

function formatRel(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = 60_000,
    hr = 60 * min,
    day = 24 * hr;
  if (diff < min) return "just now";
  if (diff < hr) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hr)}h ago`;
  const days = Math.floor(diff / day);
  return days < 30 ? `${days}d ago` : new Date(iso).toLocaleDateString();
}

export function SessionToolbar({
  sessionId,
  sessionName,
  snapshot,
  targetId,
  updatedAtISO,
  snapshotCount,
  driftReport,
}: Props) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [wallOpen, setWallOpen] = useState(false);
  const [driftOpen, setDriftOpen] = useState(false);
  const [badgeOpen, setBadgeOpen] = useState(false);
  const [wrappedOpen, setWrappedOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const shareMenuRef = useRef<HTMLDivElement>(null);
  const overflowMenuRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (shareMenuRef.current && !shareMenuRef.current.contains(e.target as Node)) {
        setShareMenuOpen(false);
      }
      if (
        overflowMenuRef.current &&
        !overflowMenuRef.current.contains(e.target as Node)
      ) {
        setOverflowOpen(false);
      }
    }
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, []);

  function refresh() {
    startRefresh(async () => {
      setMessage(null);
      try {
        // POST returns immediately with a jobId — actual refresh runs
        // detached via Next.js's after(). Same big-repo-friendly flow as
        // session-create.
        const ownerId = getOrCreateOwnerId();
        const res = await fetch(`/api/sessions/${sessionId}/refresh`, {
          method: "POST",
          headers: ownerId ? { [OWNER_ID_HEADER]: ownerId } : {},
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setMessage(data.error || `Refresh failed (HTTP ${res.status})`);
          return;
        }
        if (!data.jobId) {
          setMessage("Refresh enqueued but no jobId returned. Try again.");
          return;
        }
        // Wait for the job to finish, then reload server-rendered data.
        await pollJob(data.jobId, () => {
          /* could surface job.status for richer feedback later */
        });
        router.refresh();
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Refresh failed");
      }
    });
  }

  function remove() {
    if (!confirm(`Delete session "${sessionName}"? This cannot be undone.`)) return;
    startDelete(async () => {
      const ownerId = getOrCreateOwnerId();
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "DELETE",
        headers: ownerId ? { [OWNER_ID_HEADER]: ownerId } : {},
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMessage(data.error || `Delete failed (HTTP ${res.status})`);
        return;
      }
      router.push("/");
      router.refresh();
    });
  }

  async function screenshot() {
    setShareMenuOpen(false);
    const el = document.getElementById(targetId);
    if (!el) {
      setMessage("Couldn't find content to capture");
      return;
    }
    try {
      const dataUrl = await htmlToImage.toPng(el, {
        pixelRatio: 2,
        backgroundColor:
          getComputedStyle(document.body).getPropertyValue("background-color") ||
          TOK.bg,
        cacheBust: true,
      });
      const link = document.createElement("a");
      link.download = `codetrawl-${sessionName.replace(/\s+/g, "-").toLowerCase()}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Screenshot failed");
    }
  }

  return (
    <div
      className="border-b sticky top-0 z-30"
      style={{ borderColor: TOK.border, background: TOK.bgDeep }}
    >
      <div className="px-5 h-12 flex items-center gap-3">
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          {/* Logo doubles as a home link — clickable from any session
           *  page back to the landing / workspace. Sized large enough
           *  to make the Baron mascot's detail (top hat, moustache,
           *  beard) readable without dominating the 48px-tall toolbar. */}
          <Logo size={26} href="/" />
          <span style={{ color: TOK.border }}>·</span>
          <span
            className="font-mono text-sm truncate"
            style={{ color: TOK.textPrimary }}
          >
            {snapshot.repo.fullName}
          </span>
          {snapshot.analyzedRef && (
            <span
              className="text-[11px] shrink-0 inline-flex items-center gap-1 font-mono"
              style={{ color: TOK.textMuted }}
              title={`Analyzed on branch ${snapshot.analyzedRef}`}
            >
              <GitBranch size={11} aria-hidden />
              <span className="max-w-[160px] truncate">
                {snapshot.analyzedRef}
              </span>
            </span>
          )}
          <span
            className="text-[11px] shrink-0 inline-flex items-center gap-1"
            style={{ color: TOK.textMuted }}
            title={`Snapshot ${snapshotCount} of ${snapshotCount} · ${updatedAtISO}`}
          >
            <span style={{ color: TOK.border }}>·</span>
            <span>
              {snapshotCount} snapshot{snapshotCount === 1 ? "" : "s"}
            </span>
            <span style={{ color: TOK.border }}>·</span>
            <span>{formatRel(updatedAtISO)}</span>
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Share dropdown */}
          <div ref={shareMenuRef} className="relative">
            <button
              onClick={() => setShareMenuOpen((v) => !v)}
              className="h-8 px-3 rounded-md text-xs transition flex items-center gap-1.5"
              style={{
                background: TOK.surface,
                border: `1px solid ${TOK.border}`,
                color: TOK.textSecondary,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = TOK.borderStrong;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = TOK.border;
              }}
            >
              <Share2 size={14} />
              <span>Share</span>
              <ChevronDown size={12} style={{ color: TOK.textMuted }} />
            </button>
            {shareMenuOpen && (
              <div
                className="absolute right-0 mt-1 w-56 rounded-lg py-1 z-50 shadow-xl"
                style={{
                  background: TOK.surfaceElevated,
                  border: `1px solid ${TOK.borderStrong}`,
                }}
              >
                <MenuItem
                  icon={<Sparkles size={14} />}
                  label="Share card"
                  hint="1200×630 branded PNG"
                  onClick={() => {
                    setShareMenuOpen(false);
                    setShareOpen(true);
                  }}
                />
                <MenuItem
                  icon={<ShieldAlert size={14} />}
                  label="Load-bearing walls"
                  hint="The files nobody dares touch"
                  onClick={() => {
                    setShareMenuOpen(false);
                    setWallOpen(true);
                  }}
                />
                <MenuItem
                  icon={<TrendingUp size={14} />}
                  label="Drift trends"
                  hint="Direction of travel across sweeps"
                  onClick={() => {
                    setShareMenuOpen(false);
                    setDriftOpen(true);
                  }}
                />
                <MenuItem
                  icon={<Award size={14} />}
                  label="README badge"
                  hint="Grade + trend backlink for your README"
                  onClick={() => {
                    setShareMenuOpen(false);
                    setBadgeOpen(true);
                  }}
                />
                <MenuItem
                  icon={<Gift size={14} />}
                  label="Contributor Wrapped"
                  hint="Per-person portrait cards"
                  onClick={() => {
                    setShareMenuOpen(false);
                    setWrappedOpen(true);
                  }}
                />
                <MenuItem
                  icon={<Camera size={14} />}
                  label="Screenshot page"
                  hint="Capture everything as PNG"
                  onClick={screenshot}
                />
              </div>
            )}
          </div>

          {/* Feedback — ghost pill (neutral border, secondary text).
           *  Was previously a green accent-bordered pill, but it sat
           *  right next to the green Refresh button — two competing
           *  accent actions side-by-side. v0.76 polish neutralises it
           *  (matches the MarketingNav Feedback treatment) so Refresh
           *  stays the only green action in the toolbar. Beta testers
           *  still see a dedicated pill, just without the colour
           *  conflict. */}
          <WatchToggle sessionId={sessionId} />

          <RefineScope
            sessionId={sessionId}
            current={snapshot.analyzedExcludeFolders}
          />

          <button
            onClick={() => setFeedbackOpen(true)}
            className="h-8 px-3 rounded-md text-xs transition flex items-center gap-1.5 hover:bg-white/5"
            style={{
              color: TOK.textSecondary,
              border: `1px solid rgba(255, 255, 255, 0.1)`,
            }}
          >
            <MessageSquarePlus size={13} />
            <span>Feedback</span>
          </button>

          {/* Refresh — primary */}
          <button
            onClick={refresh}
            disabled={refreshing}
            className="h-8 px-3 rounded-md text-xs font-medium transition flex items-center gap-1.5 disabled:opacity-40 hover:brightness-110"
            style={{
              background: TOK.accent,
              color: TOK.accentOn,
            }}
          >
            <RefreshCw
              size={13}
              className={refreshing ? "animate-spin" : ""}
            />
            <span>{refreshing ? "Refreshing…" : "Refresh"}</span>
          </button>

          {/* Overflow */}
          <div ref={overflowMenuRef} className="relative">
            <button
              onClick={() => setOverflowOpen((v) => !v)}
              className="h-8 w-8 rounded-md transition flex items-center justify-center"
              style={{
                background: TOK.surface,
                border: `1px solid ${TOK.border}`,
                color: TOK.textMuted,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = TOK.borderStrong;
                e.currentTarget.style.color = TOK.textSecondary;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = TOK.border;
                e.currentTarget.style.color = TOK.textMuted;
              }}
              aria-label="More actions"
            >
              <MoreHorizontal size={14} />
            </button>
            {overflowOpen && (
              <div
                className="absolute right-0 mt-1 w-48 rounded-lg py-1 z-50 shadow-xl"
                style={{
                  background: TOK.surfaceElevated,
                  border: `1px solid ${TOK.borderStrong}`,
                }}
              >
                <Link
                  href="/help"
                  target="_blank"
                  rel="noopener"
                  onClick={() => setOverflowOpen(false)}
                  className="flex items-start gap-2.5 px-3 py-2 text-xs transition cursor-pointer"
                  style={{ color: TOK.textSecondary }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = TOK.surface;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <HelpCircle
                    size={14}
                    style={{ color: TOK.textMuted, marginTop: 1 }}
                  />
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span style={{ color: TOK.textPrimary }}>Help</span>
                    <span
                      className="text-[11px]"
                      style={{ color: TOK.textMuted }}
                    >
                      What the panels and signals mean
                    </span>
                  </div>
                </Link>
                {/* Send feedback moved to top-level toolbar button
                 *  (emphasis during early beta). Removed the
                 *  overflow-menu entry to avoid duplication. */}
                <div
                  className="my-1 mx-2 h-px"
                  style={{ background: TOK.border }}
                />
                <MenuItem
                  icon={<Trash2 size={14} />}
                  label="Delete session"
                  danger
                  disabled={deleting}
                  onClick={() => {
                    setOverflowOpen(false);
                    remove();
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {message && (
        <div
          className="px-5 py-2 text-xs border-t"
          style={{ color: TOK.rose, borderColor: TOK.border }}
        >
          {message}
        </div>
      )}

      <ShareCardModal
        snapshot={snapshot}
        sessionName={sessionName}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
      />
      <WallCardModal
        snapshot={snapshot}
        sessionName={sessionName}
        open={wallOpen}
        onClose={() => setWallOpen(false)}
      />
      <DriftCardModal
        snapshot={snapshot}
        report={driftReport}
        sessionName={sessionName}
        open={driftOpen}
        onClose={() => setDriftOpen(false)}
      />
      <BadgeModal
        sessionId={sessionId}
        isPrivate={snapshot.repo?.private === true}
        open={badgeOpen}
        onClose={() => setBadgeOpen(false)}
      />
      <ContributorWrappedModal
        snapshot={snapshot}
        open={wrappedOpen}
        onClose={() => setWrappedOpen(false)}
      />
      <FeedbackModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        sessionId={sessionId}
      />
    </div>
  );
}

function MenuItem({
  icon,
  label,
  hint,
  danger,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition disabled:opacity-40"
      style={{
        color: danger ? TOK.rose : TOK.textPrimary,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = TOK.surface;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <span className="shrink-0 mt-0.5" aria-hidden>
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <div>{label}</div>
        {hint && (
          <div
            className="text-[11px] mt-0.5"
            style={{ color: TOK.textMuted }}
          >
            {hint}
          </div>
        )}
      </div>
    </button>
  );
}
