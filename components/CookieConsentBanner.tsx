"use client";

// Site-wide cookie-consent banner. The Cookie Policy promises one ("when you
// first visit, a banner asks you to accept or decline the optional functional
// storage"), but the only existing banner was bolted to the retired RepoJury
// surface and never rendered on the live CodeTrawl site. This one mounts in
// the root layout so it appears on the first visit to ANY page (landing,
// pricing, legal, auth, workspace), not just "/".
//
// Self-contained inline styles (bitumen + bone, no orange) so it renders
// consistently across every theme island without depending on the `.ct`
// scope or any stylesheet. Reads/writes the shared lib/cookieConsent state,
// which the functional-storage call sites (e.g. the owner-id in
// CTLandingIntake) already gate on — so "Decline" genuinely suppresses
// non-essential storage.

import { useEffect, useState } from "react";
import Link from "next/link";
import { getConsent, setConsent } from "@/lib/cookieConsent";

export function CookieConsentBanner() {
  // Render nothing until mounted (localStorage isn't readable on the server)
  // and only when no choice has been made yet.
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (getConsent() === null) setShow(true);
  }, []);

  if (!show) return null;

  function choose(state: "accepted" | "declined") {
    setConsent(state);
    setShow(false);
  }

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      style={{
        position: "fixed",
        left: 16,
        right: 16,
        bottom: 16,
        zIndex: 40,
        margin: "0 auto",
        maxWidth: 560,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 14,
        padding: "14px 16px",
        borderRadius: 12,
        background: "#15140f",
        border: "1px solid rgba(242,239,234,0.12)",
        boxShadow: "0 12px 32px -12px rgba(0,0,0,0.7)",
        color: "#f2efea",
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <p style={{ flex: "1 1 240px", margin: 0, color: "rgba(242,239,234,0.78)" }}>
        CodeTrawl uses essential cookies to keep you signed in. We&rsquo;d also
        like to use functional storage for small conveniences. No tracking, no
        ads. See our{" "}
        <Link
          href="/cookies"
          style={{ color: "#f2efea", textDecoration: "underline" }}
        >
          Cookie Policy
        </Link>
        .
      </p>
      <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
        <button
          type="button"
          onClick={() => choose("declined")}
          style={{
            background: "transparent",
            color: "#f2efea",
            border: "1px solid rgba(242,239,234,0.18)",
            borderRadius: 8,
            padding: "8px 14px",
            fontSize: 12.5,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Decline
        </button>
        <button
          type="button"
          onClick={() => choose("accepted")}
          style={{
            background: "#f2efea",
            color: "#0c0b0a",
            border: "none",
            borderRadius: 8,
            padding: "8px 14px",
            fontSize: 12.5,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Accept
        </button>
      </div>
    </div>
  );
}
