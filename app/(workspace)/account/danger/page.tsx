// /account/danger — destructive account actions (v0.76 / D4).
//
// Currently only Delete account as Coming soon. Kept as a dedicated
// route so it has a stable URL when we wire up the actual deletion
// + confirmation flow.

import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/authSession";
import { userFromSession } from "@/lib/userFromSession";
import { SettingsShell } from "@/components/account/SettingsShell";
import { DangerPanel } from "@/components/account/DangerPanel";

export const metadata = {
  title: "Danger zone — Account — CodeTrawl",
  description: "Permanent account actions.",
};

export default async function DangerPage() {
  const session = await getAuthSession();
  if (!session) redirect("/login?next=/account/danger");

  const user = userFromSession(session);

  return (
    <SettingsShell user={user}>
      <DangerPanel />
    </SettingsShell>
  );
}
