// /how-it-works — in-workspace explainer inside the Chambers shell.

import type { Metadata } from "next";
import { HowItWorksView } from "@/components/chambers/HowItWorksView";
import { VERDICT_SIGNAL_COUNT } from "@/lib/intelligence/verdict";

export const metadata: Metadata = {
  title: "How it works — CodeTrawl",
  description:
    `How CodeTrawl reaches a grade: four lenses, ${VERDICT_SIGNAL_COUNT} deterministic signals, zero AI guessing.`,
};

export default function HowItWorksPage() {
  return <HowItWorksView />;
}
