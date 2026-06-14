"use client";

// CTIntake — the URL intake on the CodeTrawl hero. Same analysis flow as the
// old landing's HeroIntake (login-gated POST /api/sessions → poll → open the
// session), restyled and made CONTROLLED: the parent owns the value so the
// survey panel underneath can live-mirror what you type — the input and the
// hero artifact form one continuous narrative (paste → sweep → survey).
//
//   logged in  → run the analysis inline and open the session when done
//   logged out → stash the repo in sessionStorage, send to /signup; the
//                mount effect resumes the run automatically on return

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { pollJob } from "@/lib/jobsClient";
import { getOrCreateOwnerId, OWNER_ID_HEADER } from "@/lib/ownerId";
import { hasFunctionalConsent } from "@/lib/cookieConsent";
import { authClient } from "@/lib/authClient";

const PENDING_REPO_KEY = "ct:pending-repo";

const SAMPLES: { label: string; repo: string }[] = [
  { label: "zod", repo: "colinhacks/zod" },
  { label: "flask", repo: "pallets/flask" },
  { label: "gin", repo: "gin-gonic/gin" },
];

/** Strip protocol / github.com so both "owner/repo" and full URLs work —
 *  the server does the real parsing. Exported so the survey panel can
 *  normalize the live-mirrored value the same way (pasting a full URL must
 *  not render "github.com/https://github.com/…" in the panel header). */
export function normalizeRepo(raw: string): string {
  return raw.trim().replace(/^https?:\/\//, "").replace(/^github\.com\//, "");
}

interface Props {
  value: string;
  onChange: (v: string) => void;
}

export function CTIntake({ value, onChange }: Props) {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const loggedIn = !!session?.user;

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
          setError("The analysis finished but nothing was created — try again or pick another repo.");
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
    router.push("/signup");
  }

  function runSweep(repo: string) {
    const normalized = normalizeRepo(repo);
    if (!normalized || pending) return;
    if (loggedIn) {
      runAnalysis(normalized);
    } else {
      stashAndSignup(normalized);
    }
  }

  // Resume-after-signup: same contract as the old landing.
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
      onChange(stashed);
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
          runSweep(value);
        }}
      >
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={pending}
          placeholder="github.com/owner/repo"
          aria-label="Repository URL"
          aria-invalid={!!error}
          aria-describedby={error ? "intake-err" : undefined}
        />
        {/* "Run sweep" is the one granted lexicon exception (see the guard
            comment in codetrawl.css) — the brand verb on the primary CTA. */}
        <button type="submit" disabled={pending}>
          {pending ? "Sweeping…" : "Run sweep"}
        </button>
      </form>
      {/* Persistent polite live region: announces both errors and the
          pending state to screen readers (the run can take ~60s). */}
      <div id="intake-err" className="intake-err" role="status" aria-live="polite">
        {error ?? (pending ? "Analysis running — this can take about a minute." : "")}
      </div>
      <div className="intake-micro">
        public repos · free account · zero config · survey in ~60s
      </div>
      <div className="samples">
        <span>or try a sample —</span>
        {SAMPLES.map((s) => (
          <button
            key={s.label}
            type="button"
            disabled={pending}
            aria-label={`Analyze sample repository ${s.repo}`}
            onClick={() => runSweep(s.repo)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </>
  );
}
