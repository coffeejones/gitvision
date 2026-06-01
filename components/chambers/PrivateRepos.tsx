"use client";

// PrivateRepos — the un-analyzed half of the Private tab. Loads the
// user's private GitHub repos (all of them, in 100-chunks, into memory)
// then offers instant search + an 8-per-page table. Each row's
// "Analyse" button opens a new case (POST /api/sessions → poll the job
// → navigate). Already-analyzed private repos are shown as cases above,
// so they're filtered out here.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Lock,
  Loader2,
  ArrowRight,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { pollJob } from "@/lib/jobsClient";
import { CH, CH_FOCUS } from "./theme";

interface Repo {
  fullName: string;
  name: string;
  pushedAt: string | null;
  language: string | null;
}

const PAGE_SIZE = 8;
const MAX_PAGES = 5; // up to 500 repos held client-side

const BTN_ACTIVE = {
  background: "linear-gradient(180deg, #16d39a, #0fa97a)",
  color: "#04130d",
  boxShadow:
    "0 1px 0 rgba(255,255,255,0.25) inset, 0 8px 18px -8px rgba(16,185,129,0.55)",
};
const BTN_BUSY = { background: CH.elevated, color: CH.textDim, boxShadow: "none" };

export function PrivateRepos({ analyzedRepos }: { analyzedRepos: Set<string> }) {
  const router = useRouter();
  const [allRepos, setAllRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [analyzing, setAnalyzing] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const acc: Repo[] = [];
        let p = 1;
        let more = true;
        while (more && p <= MAX_PAGES) {
          const res = await fetch(`/api/github/repos?page=${p}`);
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error ?? "Could not load repositories.");
          if (data.connected === false) {
            if (!cancelled) setConnected(false);
            break;
          }
          acc.push(...((data.repos ?? []) as Repo[]));
          more = !!data.hasMore;
          p++;
        }
        if (!cancelled) setAllRepos(acc);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Could not load repositories.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allRepos
      .filter((r) => !analyzedRepos.has(r.fullName))
      .filter(
        (r) =>
          !q ||
          r.name.toLowerCase().includes(q) ||
          r.fullName.toLowerCase().includes(q),
      );
  }, [allRepos, analyzedRepos, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const pageItems = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  async function analyze(fullName: string) {
    if (analyzing) return;
    setAnalyzing(fullName);
    setError(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: `https://github.com/${fullName}` }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.jobId) {
        throw new Error(data.error ?? "Could not start analysis.");
      }
      const job = await pollJob(data.jobId, () => {});
      if (!job.sessionId) throw new Error("Analysis finished but no case was created.");
      router.push(`/session/${job.sessionId}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start analysis.");
      setAnalyzing(null);
    }
  }

  if (!connected) {
    return (
      <div
        className="rounded-xl px-5 py-8 text-center text-[13.5px]"
        style={{ background: CH.panel, border: `1px dashed ${CH.border}`, color: CH.textDim }}
      >
        Connect GitHub with repo access to list your private repositories.{" "}
        <a href="/account/connections" className="underline" style={{ color: CH.accent }}>
          Manage connection →
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* header + search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3
          className="text-[11px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: CH.textMuted }}
        >
          From your GitHub account
        </h3>
        <div
          className="flex items-center gap-2 rounded-lg px-3 py-1.5"
          style={{ background: CH.panel, border: `1px solid ${CH.border}` }}
        >
          <Search size={13} style={{ color: CH.textMuted }} />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search repositories…"
            className="w-44 bg-transparent text-[13px] outline-none placeholder:opacity-60"
            style={{ color: CH.text }}
          />
        </div>
      </div>

      {loading ? (
        <div
          className="flex items-center justify-center gap-2 py-8 text-[13px]"
          style={{ color: CH.textMuted }}
        >
          <Loader2 size={14} className="animate-spin" />
          Loading repositories…
        </div>
      ) : pageItems.length === 0 ? (
        <div
          className="rounded-xl px-5 py-8 text-center text-[13.5px]"
          style={{ background: CH.panel, border: `1px dashed ${CH.border}`, color: CH.textDim }}
        >
          {query.trim()
            ? `No repositories match “${query.trim()}”.`
            : "No private repositories left to analyse."}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {pageItems.map((r) => {
              const busy = analyzing === r.fullName;
              const otherBusy = analyzing !== null && !busy;
              return (
                <div
                  key={r.fullName}
                  className="flex items-center gap-3 rounded-xl px-4 py-3"
                  style={{ background: CH.panel, border: `1px solid ${CH.border}` }}
                >
                  <Lock size={13} className="flex-none" style={{ color: CH.textMuted }} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span
                      className="truncate text-[14px] font-medium"
                      style={{ color: CH.text }}
                    >
                      {r.name}
                    </span>
                    <span className="truncate text-[11.5px]" style={{ color: CH.textMuted }}>
                      {r.fullName}
                      {r.language ? ` · ${r.language}` : ""}
                      {r.pushedAt ? ` · pushed ${ago(r.pushedAt)}` : ""}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => analyze(r.fullName)}
                    disabled={analyzing !== null}
                    className={`flex-none inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition-all hover:-translate-y-px disabled:translate-y-0 ${CH_FOCUS}`}
                    style={{
                      ...(busy || !otherBusy ? BTN_ACTIVE : BTN_BUSY),
                      opacity: otherBusy ? 0.5 : 1,
                    }}
                  >
                    {busy ? (
                      <>
                        <Loader2 size={13} className="animate-spin" />
                        Analysing…
                      </>
                    ) : (
                      <>
                        Analyse
                        <ArrowRight size={14} />
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          {/* pagination */}
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[12px]" style={{ color: CH.textMuted }}>
              {filtered.length} {filtered.length === 1 ? "repository" : "repositories"}
            </span>
            <div className="flex items-center gap-1">
              <PagerButton
                disabled={current <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                label="Previous page"
              >
                <ChevronLeft size={15} />
              </PagerButton>
              <span
                className="px-2 text-[12px] tabular-nums"
                style={{ color: CH.textDim }}
              >
                Page {current} of {totalPages}
              </span>
              <PagerButton
                disabled={current >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                label="Next page"
              >
                <ChevronRight size={15} />
              </PagerButton>
            </div>
          </div>
        </>
      )}

      {error && (
        <p className="text-center text-[12.5px]" style={{ color: CH.critical }}>
          {error}
        </p>
      )}
    </div>
  );
}

function PagerButton({
  disabled,
  onClick,
  label,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:opacity-30 ${CH_FOCUS}`}
      style={{
        background: CH.panel,
        border: `1px solid ${CH.border}`,
        color: CH.textDim,
      }}
    >
      {children}
    </button>
  );
}

function ago(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d < 1) return "today";
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}
