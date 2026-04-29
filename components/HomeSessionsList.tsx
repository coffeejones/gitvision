"use client";

// Landing-page session list with client-side owner-id filter.
//
// The server hands us EVERY session — filtering can't happen server-side
// because the owner-id lives in localStorage. We hydrate, read the
// stored id, and keep only sessions matching that id (plus legacy
// sessions that have no ownerId at all, so existing data remains
// reachable for everyone after the v0.26 migration).
//
// Soft isolation only: anyone with a session URL can still open it
// directly. We're just protecting the landing page from showing
// strangers' sessions.

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SessionSummary } from "@/lib/types";
import { filterSessionsByOwner, getOrCreateOwnerId } from "@/lib/ownerId";
import { TOK } from "@/lib/theme";
import { SessionRow } from "./SessionRow";

interface Props {
  initialSessions: SessionSummary[];
}

export function HomeSessionsList({ initialSessions }: Props) {
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Read or generate the owner-id on mount. We can't do this during SSR
  // because localStorage doesn't exist there, so the server-rendered
  // first paint shows ALL sessions and the client narrows the list as
  // soon as it hydrates. Brief flash for new visitors who own nothing
  // yet — acceptable.
  useEffect(() => {
    setOwnerId(getOrCreateOwnerId());
    setHydrated(true);
  }, []);

  // Pre-hydration render shows everything (server's view). Once hydrated,
  // filter to "yours + ownerless legacy" via the shared pure helper.
  const visible = !hydrated
    ? initialSessions
    : filterSessionsByOwner(initialSessions, ownerId);

  const hiddenCount = initialSessions.length - visible.length;

  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-[0.2em]">
          Your sessions
        </h2>
        <div className="text-xs" style={{ color: TOK.textMuted }}>
          {visible.length} saved
          {hiddenCount > 0 && (
            <span
              className="ml-2"
              title="Sessions created in other browsers are hidden here. They're still reachable via direct URL — sharing links works."
              style={{ color: TOK.textMuted }}
            >
              · {hiddenCount} from other browsers hidden
            </span>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <div
          className="rounded-xl border border-dashed p-10 text-center text-sm flex flex-col gap-1"
          style={{
            borderColor: TOK.border,
            color: TOK.textMuted,
          }}
        >
          <div>No sessions yet.</div>
          <div className="text-[11px]">
            Paste a GitHub URL above, or try one of the demo repos to see
            what GitVision does.
          </div>
        </div>
      ) : (
        <div
          className="rounded-xl overflow-hidden"
          style={{
            background: TOK.surface,
            border: `1px solid ${TOK.border}`,
          }}
        >
          {visible.map((s, i) => (
            <Link key={s.id} href={`/session/${s.id}`} className="block">
              <SessionRow
                session={s}
                isLast={i === visible.length - 1}
              />
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
