// /how-it-works — in-workspace explainer inside the Chambers shell.

import type { Metadata } from "next";
import { HowItWorksView } from "@/components/chambers/HowItWorksView";

export const metadata: Metadata = {
  title: "How it works — RepoJury",
  description:
    "How RepoJury reaches a verdict: four departments, ~20 deterministic signals, zero AI guessing.",
};

export default function HowItWorksPage() {
  return <HowItWorksView />;
}
