"use client";

// CTLandingIntake — the URL intake on the landing (hero + close). Same
// analysis flow as the retired CTIntake, restyled for the current landing:
//
//   logged in  → run the analysis inline (POST /api/sessions → poll) and open
//                the session's verdict when done
//   logged out → stash the repo in sessionStorage, send to /signup; the mount
//                effect resumes the run automatically on return (hero instance
//                only — `resume` — so two intakes never double-run the stash)
//
// The field carries the landing's signature: an ambient ember halo plus a
// conic light orbiting the outline (transform-rotated — painted once).

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { pollJob } from "@/lib/jobsClient";
import { getOrCreateOwnerId, OWNER_ID_HEADER } from "@/lib/ownerId";
import { hasFunctionalConsent } from "@/lib/cookieConsent";
import { authClient } from "@/lib/authClient";
import { DEMO_SESSIONS } from "@/lib/demoSessions";
import { PENDING_REPO_KEY } from "@/lib/pendingRepo";

/** Strip protocol / github.com so both "owner/repo" and full URLs work —
 *  the server does the real parsing. */
export function normalizeRepo(raw: string): string {
  return raw.trim().replace(/^https?:\/\//, "").replace(/^github\.com\//, "");
}

export function CTLandingIntake({ resume = false }: { resume?: boolean }) {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const loggedIn = !!session?.user;
  const errId = useId();

  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function runAnalysis(normalized: string) {
    setError(null);
    startTransition(async () => {
      try {
        const ownerId = hasFunctionalConsent() ? getOrCreateOwnerId() : null;
        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(ownerId ? { [OWNER_ID_HEADER]: ownerId } : {}),
          },
          body: JSON.stringify({ repoUrl: normalized }),
        });
        const data = (await res.json().catch(() => null)) as {
          error?: string;
          message?: string;
          jobId?: string;
        } | null;

        if (res.status === 401) {
          stashAndSignup(normalized);
          return;
        }
        if (!res.ok) {
          setError(
            data?.message ??
              data?.error ??
              "Couldn't start the analysis. Check the repo and try again."
          );
          return;
        }
        if (!data?.jobId) {
          setError("Server returned no job — try again or pick another repo.");
          return;
        }

        const job = await pollJob(data.jobId, () => {});
        if (!job.sessionId) {
          setError(
            "The analysis finished but nothing was created — try again or pick another repo."
          );
          return;
        }
        router.push(`/session/${job.sessionId}/verdict`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error.");
      }
    });
  }

  function stashAndSignup(normalized: string) {
    try {
      sessionStorage.setItem(PENDING_REPO_KEY, normalized);
    } catch {
      /* sessionStorage unavailable — proceed to signup anyway */
    }
    router.push("/signup?next=/cases");
  }

  function runSweep(repo: string) {
    const normalized = normalizeRepo(repo);
    if (!normalized || pending) return;
    if (loggedIn) runAnalysis(normalized);
    else stashAndSignup(normalized);
  }

  // Resume-after-signup: the hero instance picks the stashed repo back up.
  const resumedRef = useRef(false);
  useEffect(() => {
    if (!resume || resumedRef.current || !loggedIn) return;
    let stashed: string | null = null;
    try {
      stashed = sessionStorage.getItem(PENDING_REPO_KEY);
    } catch {
      /* ignore */
    }
    if (stashed) {
      resumedRef.current = true;
      try {
        sessionStorage.removeItem(PENDING_REPO_KEY);
      } catch {
        /* ignore */
      }
      setValue(stashed);
      runAnalysis(stashed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume, loggedIn]);

  return (
    <div className="rk-intake">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          runSweep(value);
        }}
      >
        <span className="rk-field">
          <span className="rk-field-glow" aria-hidden />
          <span className="rk-field-beam" aria-hidden />
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={pending}
            placeholder="github.com/pallets/flask"
            aria-label="Repository URL"
            aria-invalid={!!error}
            aria-describedby={error ? errId : undefined}
          />
        </span>
        <button type="submit" disabled={pending}>
          {pending ? "Reading…" : "Read the repo"}
        </button>
      </form>
      {/* Polite live region: announces errors and the ~60s pending state. */}
      <div id={errId} className="rk-intake-err" role="status" aria-live="polite">
        {error ?? (pending ? "Analysis running — this can take about a minute." : "")}
      </div>
      <p className="rk-demos">
        or open one that&apos;s already done —{" "}
        {DEMO_SESSIONS.map((d, i) => (
          <span key={d.label}>
            {/* If a demo id is ever unset, fall back to the stash→signup
                analyze flow (same contract as the retired CTIntake) so the
                visitor's chosen repo isn't dropped at the signup wall. */}
            <a
              href={d.sessionId ? `/session/${d.sessionId}` : "/signup?next=/cases"}
              onClick={
                d.sessionId
                  ? undefined
                  : (e) => {
                      e.preventDefault();
                      runSweep(d.repo);
                    }
              }
            >
              {d.label}
            </a>
            {i < DEMO_SESSIONS.length - 1 ? " · " : ""}
          </span>
        ))}
        <span className="rk-demos-tail"> · no sign-up</span>
      </p>
    </div>
  );
}
