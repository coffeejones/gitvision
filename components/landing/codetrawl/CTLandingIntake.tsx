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

export function CTLandingIntake({
  resume = false,
  demoHref,
}: {
  resume?: boolean;
  /** Prefer the in-page report list when it actually rendered. */
  demoHref?: string;
}) {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const loggedIn = !!session?.user;
  const errId = useId();

  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Where "read one already swept" goes. Prefer the in-page proof section when
  // this intake is on the landing; the close instance links there too, since
  // scrolling back up to the cards beats a cold link into one repo. Falls back
  // to the first configured demo session if the section is ever removed.
  const firstDemo = DEMO_SESSIONS.find((d) => d.sessionId);
  const firstDemoHref = demoHref ?? (
    firstDemo ? `/session/${firstDemo.sessionId}` : "/signup?next=/cases"
  );

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
            autoComplete="url"
            autoCapitalize="none"
            spellCheck={false}
            inputMode="url"
            aria-label="Repository URL"
            aria-invalid={!!error}
            aria-describedby={error ? errId : undefined}
          />
        </span>
        <button type="submit" disabled={pending}>
          {pending ? "Analyzing…" : "Analyze repository"}
        </button>
      </form>
      {/* Polite live region: announces errors and the ~60s pending state. */}
      <div id={errId} className="rk-intake-err" role="status" aria-live="polite">
        {error ?? (pending ? "Analysis running — this can take about a minute." : "")}
      </div>
      {/* Say what the button does BEFORE it is pressed.
          Every visitor who sees this page is logged out (app/page.tsx sends
          signed-in users to /cases), and for them the submit above resolves to
          stashAndSignup → /signup. The page used to promise "nothing to
          install" and "no sign-up" around a large orange button that delivered
          a signup form with no warning, which is a bait-and-switch even though
          the repo is kept and resumed afterwards. The honest version costs one
          line and points at the path that genuinely needs no account.
          Suppressed while a sweep is running — that is the post-signup resume,
          where the visitor already has an account. */}
      {!loggedIn && !pending && (
        <p className="rk-intake-note">
          Sweeping your own repo takes a free account — we&apos;ll keep the URL
          and run it the moment you land.{" "}
          <a href={firstDemoHref}>Or read one already swept</a>, no account at
          all.
        </p>
      )}
    </div>
  );
}
