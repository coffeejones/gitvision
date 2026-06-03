// /pr-bot — PR-bot surface inside the Chambers shell.

import type { Metadata } from "next";
import { getChambersUser } from "@/lib/chambersUser";
import { PRBotView } from "@/components/chambers/PRBotView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "PR-bot — RepoJury",
  description:
    "RepoJury-PR: one grounded review comment on every pull request — the same deterministic signal layer as the workspace, zero LLM cost.",
};

export default async function PRBotPage() {
  // Layout already guards auth, so this is non-null in practice.
  const user = await getChambersUser();
  return <PRBotView canInstall={user?.paid ?? false} />;
}
