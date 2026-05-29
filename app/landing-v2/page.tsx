// Review route for the RepoJury landing. Lives at /landing-v2 so we
// can compare it against the current home at / without breaking
// traffic. Swap into the root once approved + repojury.com is wired.

import type { Metadata } from "next";
import { RepoJury } from "@/components/landing/repojury/RepoJury";

export const metadata: Metadata = {
  title: "RepoJury — every repo has a verdict",
  description:
    "Four departments examine your codebase — health, security, forensics, supply — and return a verdict score you can defend. Bus factor, untested hotspots, blast radius, dependency risk, from one URL.",
};

export default function LandingV2Page() {
  return <RepoJury />;
}
