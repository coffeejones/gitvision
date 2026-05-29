"use client";

// HeroIntake — the case-intake field on the landing hero (Phase M).
//
// Was a static <input> + button in the mockup. Now it routes into the
// real analysis flow: on submit it sends the user to "/" with the repo
// pre-filled (?repo=owner/repo), where the existing RepoInputForm picks
// it up and runs the full POST /api/sessions → poll → /session/[id]
// pipeline. We deliberately don't duplicate that pipeline here — the
// home form is the single tested path; this is just a styled on-ramp.
//
// Public repos need no login, so "Open the case" can carry an
// anonymous visitor straight into a verdict — the strongest possible
// first impression.

import { useState } from "react";
import { useRouter } from "next/navigation";

const SAMPLES: { label: string; repo: string }[] = [
  { label: "zod", repo: "colinhacks/zod" },
  { label: "django", repo: "django/django" },
  { label: "spring", repo: "spring-projects/spring-framework" },
  { label: "gin", repo: "gin-gonic/gin" },
];

/** Normalize whatever the user typed into an owner/repo or full URL
 *  that the home form understands. We pass it through mostly as-is —
 *  RepoInputForm + lib/githubUrl do the real parsing — but we strip a
 *  leading "github.com/" the placeholder implies so "vercel/next.js"
 *  and "github.com/vercel/next.js" both work. */
function normalizeRepo(raw: string): string {
  return raw.trim().replace(/^https?:\/\//, "").replace(/^github\.com\//, "");
}

export function HeroIntake() {
  const router = useRouter();
  const [value, setValue] = useState("");

  function openCase(repo: string) {
    const normalized = normalizeRepo(repo);
    if (!normalized) return;
    router.push(`/?repo=${encodeURIComponent(normalized)}`);
  }

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
          placeholder="your-org/your-repo"
          aria-label="Repository URL"
        />
        <button type="submit" className="btn btn-primary">
          Open the case
        </button>
      </form>
      <div className="samples">
        <b>See a sample verdict</b>
        {SAMPLES.map((s) => (
          <button
            key={s.label}
            type="button"
            className="chip"
            onClick={() => openCase(s.repo)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </>
  );
}
