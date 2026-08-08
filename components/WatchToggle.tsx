"use client";

// Watch toggle for the session toolbar. Puts a session on Watch (re-sweep +
// regression alerts) or removes it, via /api/watches. Loads the current state
// on mount; a Free-tier user who tries to watch is sent to /pricing (the API
// 402s — Watch is the Plus gate).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellRing, Loader2 } from "lucide-react";
import { TOK } from "@/lib/sessionTheme";

export function WatchToggle({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  // null = still loading the initial state.
  const [watching, setWatching] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/watches?sessionId=${encodeURIComponent(sessionId)}`,
        );
        const data = res.ok ? await res.json().catch(() => ({})) : {};
        if (!cancelled) setWatching(!!data.watching);
      } catch {
        if (!cancelled) setWatching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  async function toggle() {
    if (busy || watching === null) return;
    setBusy(true);
    try {
      if (watching) {
        await fetch("/api/watches", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        setWatching(false);
      } else {
        const res = await fetch("/api/watches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        if (res.status === 402) {
          router.push("/pricing");
          return;
        }
        if (res.ok) setWatching(true);
      }
    } catch {
      // Leave the state as-is; the user can retry.
    } finally {
      setBusy(false);
    }
  }

  const active = watching === true;
  const Icon = busy ? Loader2 : active ? BellRing : Bell;

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={watching === null}
      title={
        active
          ? "Watching — re-sweeps daily and alerts you if the grade regresses. Click to stop."
          : "Watch — get alerted when this repo's grade regresses"
      }
      className="h-8 px-2 sm:px-3 rounded-md text-xs transition flex items-center gap-1.5 hover:bg-white/5 disabled:opacity-40"
      aria-label={active ? "Stop watching repository" : "Watch repository"}
      style={{
        color: active ? TOK.accent : TOK.textSecondary,
        border: `1px solid ${active ? TOK.accent : "rgba(255,255,255,0.1)"}`,
      }}
    >
      <Icon size={13} className={busy ? "animate-spin" : ""} />
      <span className="hidden sm:inline">{active ? "Watching" : "Watch"}</span>
    </button>
  );
}
