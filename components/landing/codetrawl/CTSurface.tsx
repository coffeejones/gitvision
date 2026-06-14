// CTSurface — the CodeTrawl marketing shell ("SURFACE & DEPTH" system).
//
// Owns the two brand fonts, the .ct scoping class that namespaces
// codetrawl.css, and the page's atmosphere: a fine film grain and nothing
// else fixed (the hero's lamp-light lives on the hero itself). The grain is
// NEUTRAL luminosity texture — the orange budget and the no-color-glow rule
// are untouched; this only keeps the bitumen from reading as dead flat.

import "./codetrawl.css";
import type { ReactNode } from "react";
import { Schibsted_Grotesk, Fragment_Mono } from "next/font/google";

const display = Schibsted_Grotesk({
  subsets: ["latin"],
  variable: "--font-ct-display",
  display: "swap",
});

// Fragment Mono ships a single weight (400). That's a feature: emphasis in
// data is done with color and rules, never bold — see the guard in the CSS.
const mono = Fragment_Mono({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-ct-mono",
  display: "swap",
});

export function CTSurface({ children }: { children: ReactNode }) {
  return (
    <div className={`ct ${display.variable} ${mono.variable}`}>
      <div className="ct-grain" aria-hidden />
      {children}
    </div>
  );
}
