// CodeTrawl brand fonts, loaded once and shared. CTSurface uses these for the
// marketing/auth surfaces; the workspace re-skin reuses the same instances so
// next/font doesn't load the families twice. Fragment Mono ships one weight
// (400) — emphasis in data is colour/rules, never bold.

import { Schibsted_Grotesk, Fragment_Mono } from "next/font/google";

export const ctDisplay = Schibsted_Grotesk({
  subsets: ["latin"],
  variable: "--font-ct-display",
  display: "swap",
});

export const ctMono = Fragment_Mono({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-ct-mono",
  display: "swap",
});
