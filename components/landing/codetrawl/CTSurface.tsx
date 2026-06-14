// CTSurface — the CodeTrawl marketing shell ("SURFACE & DEPTH" system).
//
// Owns the two brand fonts, the .ct scoping class that namespaces
// codetrawl.css, and the page's atmosphere: a fine film grain and nothing
// else fixed (the hero's lamp-light lives on the hero itself). The grain is
// NEUTRAL luminosity texture — the orange budget and the no-color-glow rule
// are untouched; this only keeps the bitumen from reading as dead flat.

import "./codetrawl.css";
import type { ReactNode } from "react";
import { ctDisplay, ctMono } from "./ctFonts";

export function CTSurface({ children }: { children: ReactNode }) {
  return (
    <div className={`ct ${ctDisplay.variable} ${ctMono.variable}`}>
      <div className="ct-grain" aria-hidden />
      {children}
    </div>
  );
}
