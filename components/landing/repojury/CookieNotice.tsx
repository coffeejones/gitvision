"use client";

// CookieNotice — accept/decline consent banner (Phase P follow-up).
//
// RepoJury uses essential storage (always on — you can't sign in
// without the session cookie) plus optional functional storage (small
// conveniences). This banner lets the visitor accept or decline the
// optional bucket. The choice is stored via lib/cookieConsent and
// honoured at the functional-storage call sites, so "Decline" actually
// suppresses those writes rather than being decorative.
//
// Not a hard modal wall — there's no tracking to block before paint —
// but it does require an explicit choice (the banner stays until the
// visitor picks one). Rendered inside RJSurface so it shows on every
// public surface. Returns null until mounted (localStorage isn't
// readable on the server) and once a choice exists.

import { useEffect, useState } from "react";
import Link from "next/link";
import { getConsent, setConsent } from "@/lib/cookieConsent";

export function CookieNotice() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (getConsent() === null) setShow(true);
  }, []);

  function choose(state: "accepted" | "declined") {
    setConsent(state);
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="rj-cookie" role="dialog" aria-label="Cookie consent">
      <p>
        RepoJury uses essential cookies to keep you signed in. We&rsquo;d also
        like to use functional storage for small conveniences (like remembering
        your workspace). No tracking or ads. See our{" "}
        <Link href="/cookies">Cookie Policy</Link>.
      </p>
      <div className="row">
        <button
          type="button"
          className="rj-cookie-decline"
          onClick={() => choose("declined")}
        >
          Decline
        </button>
        <button
          type="button"
          className="rj-cookie-accept"
          onClick={() => choose("accepted")}
        >
          Accept
        </button>
      </div>
    </div>
  );
}
