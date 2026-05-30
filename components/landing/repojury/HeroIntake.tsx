"use client";

// HeroIntake — the case-intake field on the landing hero (Phase M;
// rewired in Phase R when the landing moved to the root route).
//
// Session creation is login-gated (v0.76 model — POST /api/sessions
// returns 401 for anonymous callers). So the flow forks on auth:
//
//   logged in  → run the analysis inline (POST → poll → verdict),
//                reusing the shared primitives (getOrCreateOwnerId,
//                pollJob) rather than duplicating RepoInputForm's
//                stage UI.
//   logged out → stash the typed repo in sessionStorage and send the
//                visitor to /signup. On return to "/", the mount
//                effect below finds the pending repo + the now-signed-
//                in session and resumes the analysis automatically —
//                so "type a URL → verdict" still holds, just with a
//                signup step in the middle.

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { pollJob } from "@/lib/jobsClient";
import { getOrCreateOwnerId, OWNER_ID_HEADER } from "@/lib/ownerId";
import { authClient } from "@/lib/authClient";

const PENDING_REPO_KEY = "rj:pending-repo";

const SAMPLES: { label: string; repo: string }[] = [
  { label: "zod", repo: "colinhacks/zod" },
  { label: "flask", repo: "pallets/flask" },
  { label: "gin", repo: "gin-gonic/gin" },
  { label: "spring", repo: "spring-projects/spring-petclinic" },
];

/** Strip a leading protocol / github.com so "vercel/next.js" and
 *  "github.com/vercel/next.js" both resolve. The server + lib/githubUrl
 *  do the real parsing — this is just cosmetic cleanup of what the
 *  placeholder implies. */
function normalizeRepo(raw: string): string {
  return raw.trim().replace(/^https?:\/\//, "").replace(/^github\.com\//, "");
}

export function HeroIntake() {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const loggedIn = !!session?.user;

  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** Run the full analysis pipeline for a normalized repo. Assumes the
   *  caller is logged in (the POST is login-gated). */
  function runAnalysis(normalized: string) {
    setError(null);
    startTransition(async () => {
      try {
        const ownerId = getOrCreateOwnerId();
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
          // Session expired between mount and submit — fall back to
          // the signup hand-off.
          stashAndSignup(normalized);
          return;
        }
        if (!res.ok) {
          setError(
            data?.message ??
              data?.error ??
              "Couldn't open the case. Check the repo and try again."
          );
          return;
        }
        if (!data?.jobId) {
          setError("Server returned no job — try again or pick another repo.");
          return;
        }

        const job = await pollJob(data.jobId, () => {});
        if (!job.sessionId) {
          setError("Analysis finished but no case file was created.");
          return;
        }
        router.push(`/session/${job.sessionId}/verdict`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error.");
      }
    });
  }

  /** Logged-out hand-off: remember the repo and send them to signup.
   *  The mount effect resumes the analysis once they're back + signed
   *  in. */
  function stashAndSignup(normalized: string) {
    try {
      sessionStorage.setItem(PENDING_REPO_KEY, normalized);
    } catch {
      /* sessionStorage unavailable — proceed to signup anyway */
    }
    router.push("/signup");
  }

  function openCase(repo: string) {
    const normalized = normalizeRepo(repo);
    if (!normalized || pending) return;
    if (loggedIn) {
      runAnalysis(normalized);
    } else {
      stashAndSignup(normalized);
    }
  }

  // Resume-after-signup: on mount, if the visitor is signed in and we
  // stashed a repo before sending them to signup, pick it back up and
  // run the analysis. Guarded by a ref so it fires at most once.
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current || !loggedIn) return;
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
  }, [loggedIn]);

  return (
    <>
      <form
        className="intake"
        onSubmit={(e) => {
          e.preventDefault();
          openCase(value);
        }}
      >
        <span className="pre">github.com/</span>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={pending}
          placeholder="your-org/your-repo"
          aria-label="Repository URL"
        />
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Examining…" : "Open the case"}
        </button>
      </form>
      {error && <div className="intake-err">{error}</div>}
      <div className="samples">
        <b>See a sample verdict</b>
        {SAMPLES.map((s) => (
          <button
            key={s.label}
            type="button"
            className="chip"
            disabled={pending}
            onClick={() => openCase(s.repo)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </>
  );
}
