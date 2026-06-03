// Workspace layout — the persistent Chambers shell (sticky sidebar) around
// every signed-in view: /cases, /pr-bot, /news, /how-it-works. Because the
// sidebar lives in the layout, navigating between these swaps ONLY the page
// content — the sidebar stays mounted (no re-render, no flash). The active
// nav item is derived from the URL inside ChambersShell.
//
// Auth guard: the workspace is signed-in-only. Anonymous callers are sent to
// login (the marketing landing at "/" is the public surface).

import { redirect } from "next/navigation";
import { getChambersUser } from "@/lib/chambersUser";
import { ChambersShell } from "@/components/chambers/ChambersShell";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getChambersUser();
  if (!user) redirect("/login");
  return <ChambersShell user={user}>{children}</ChambersShell>;
}
