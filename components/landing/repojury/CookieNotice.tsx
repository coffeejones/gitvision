"use client";

// CookieNotice — lightweight, dismissable cookie bar (Phase P).
//
// NOT a consent wall. RepoJury only uses strictly-necessary (session)
// and functional (owner-id, has-visited, pending-repo) storage today —
// no analytics or tracking — so under the ePrivacy rules a blocking
// consent gate isn't required. This is a transparency notice: tell the
// visitor what's stored, link to the full Cookie Policy, let them
// dismiss it. Dismissal persists in localStorage so it shows once.
//
// If tracking/analytics is ever added, this must be upgraded to a real
// consent mechanism (granular opt-in, stored before any non-essential
// storage runs).
//
// Rendered inside RJSurface so it appears on the public marketing +
// auth + pricing + legal surfaces. Returns null until mounted to avoid
// a hydration mismatch (localStorage isn't readable on the server).

import { useEffect, useState } from "react";
import Link from "next/link";

const DISMISS_KEY = "rj:cookie-notice";

export function CookieNotice() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(DISMISS_KEY)) setShow(true);
    } catch {
      /* localStorage blocked (private mode) — just don't show it */
    }
  }, []);

  function dismiss() {
    setShow(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* no-op */
    }
  }

  if (!show) return null;

  return (
    <div className="rj-cookie" role="region" aria-label="Cookie notice">
      <p>
        RepoJury uses essential and functional cookies to keep you signed in and
        remember small preferences. No tracking or ads. See our{" "}
        <Link href="/cookies">Cookie Policy</Link>.
      </p>
      <div className="row">
        <button type="button" onClick={dismiss}>
          Got it
        </button>
      </div>
    </div>
  );
}
