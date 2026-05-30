// RJSurface — the shared forensic-dossier shell (v0.82+ / Phase M).
//
// Every marketing + auth surface that wants the "records office"
// aesthetic wraps its content in <RJSurface>. It owns three things
// that must be identical across the landing, the auth pages, and
// /pricing so they read as one continuous brand:
//
//   1. Fonts — Fraunces (display), Hanken Grotesk (body), Spline
//      Sans Mono (case numbers). next/font requires module-scope
//      initialization, so they live here and apply as CSS variables
//      on the .rj root.
//   2. The `.rj` scoping class — every rule in repojury.css is
//      namespaced under it, so importing the CSS here once covers
//      every consumer without leaking into the TOK-dark product
//      surfaces (workspace, sessions).
//   3. Atmosphere layers — vignette, desk-line grid, film grain,
//      and the shared <defs> brass gradient. Fixed-position, behind
//      everything (pointer-events:none).
//
// The product side (workspace, session pages) deliberately does NOT
// use this — it stays on the TOK-dark theme. The aesthetic boundary
// is "marketing/auth = forensic-dossier, the tool itself = dark
// workspace", and the seam is login → workspace ("you step inside").

import "./repojury.css";
import type { ReactNode } from "react";
import { Fraunces, Hanken_Grotesk, Spline_Sans_Mono } from "next/font/google";
import { CookieNotice } from "./CookieNotice";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  style: ["normal", "italic"],
  display: "swap",
});
const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken",
  display: "swap",
});
const splineMono = Spline_Sans_Mono({
  subsets: ["latin"],
  variable: "--font-spline-mono",
  display: "swap",
});

/** One hidden <defs> so every brass crest can reference the same
 *  gradient by id (#brass) instead of redeclaring it per SVG. */
function RJDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
      <defs>
        <linearGradient id="brass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ecd488" />
          <stop offset="0.5" stopColor="#c9a227" />
          <stop offset="1" stopColor="#8f6f17" />
        </linearGradient>
      </defs>
    </svg>
  );
}

interface Props {
  children: ReactNode;
  /** Extra classes appended after the .rj + font variables — used by
   *  callers that need a layout modifier on the root (e.g. auth pages
   *  that center their content). */
  className?: string;
}

export function RJSurface({ children, className = "" }: Props) {
  return (
    <div
      className={`rj ${fraunces.variable} ${hanken.variable} ${splineMono.variable} ${className}`}
    >
      <RJDefs />
      <div className="vignette" aria-hidden />
      <div className="desk-line" aria-hidden />
      <div className="grain" aria-hidden />
      {children}
      <CookieNotice />
    </div>
  );
}
